import { SavingsProduct } from '../models/SavingsProduct';
import { SavingsPosition } from '../models/SavingsPosition';
import { applyPayoutFee } from '../config/fees';
import { logger } from '../utils/logger';

function mul(a: string, b: string): string {
  return (parseFloat(a) * parseFloat(b)).toFixed(7);
}

/**
 * Interest = amount * (apy/100) * (termDays/365)
 */
function computeInterest(amount: string, apy: string, termDays: number): string {
  const rate = parseFloat(apy) / 100;
  const years = termDays / 365;
  return mul(mul(amount, String(rate)), String(years));
}

export class SavingsService {
  async createProduct(params: {
    asset: { code: string; issuer: string };
    termDays: number;
    apy: string;
    minAmount: string;
    active?: boolean;
  }) {
    const product = await SavingsProduct.create({
      asset: params.asset,
      termDays: params.termDays,
      apy: params.apy,
      minAmount: params.minAmount ?? '0',
      active: params.active !== false,
    });
    logger.info(`Savings product created: ${product._id}`);
    return product;
  }

  async listProducts(assetFilter?: { code: string; issuer: string }) {
    const query: Record<string, unknown> = { active: true };
    if (assetFilter?.code && assetFilter?.issuer) {
      query['asset.code'] = assetFilter.code;
      query['asset.issuer'] = assetFilter.issuer;
    }
    return SavingsProduct.find(query).lean().exec();
  }

  async getProduct(productId: string) {
    return SavingsProduct.findById(productId).exec();
  }

  /**
   * Create a locked position. Caller must send funds to the savings wallet separately;
   * response includes depositInstructions for non-custodial flow.
   */
  async deposit(params: {
    userId: string;
    productId: string;
    amount: string;
    depositAddress?: string;
  }) {
    const product = await SavingsProduct.findById(params.productId).exec();
    if (!product) throw new Error('Savings product not found');
    if (!product.active) throw new Error('Product is not active');
    const amountNum = parseFloat(params.amount);
    const minNum = parseFloat(product.minAmount);
    if (isNaN(amountNum) || amountNum < minNum) throw new Error(`Amount must be >= ${product.minAmount}`);

    const unlockedAt = new Date();
    unlockedAt.setDate(unlockedAt.getDate() + product.termDays);

    const position = await SavingsPosition.create({
      userId: params.userId,
      productId: params.productId,
      amount: params.amount,
      unlockedAt,
      status: 'locked',
    });

    const depositInstructions = params.depositAddress
      ? undefined
      : {
          asset: product.asset,
          amount: params.amount,
          sendToAddress: null as string | null,
          message: 'Send the asset to the configured savings custody address (if any).',
        };

    return {
      position,
      unlockedAt,
      depositInstructions,
    };
  }

  async listPositions(userId: string, status?: 'locked' | 'withdrawn') {
    const query: Record<string, unknown> = { userId };
    if (status) query.status = status;
    return SavingsPosition.find(query).populate('productId').sort({ createdAt: -1 }).lean().exec();
  }

  async getPosition(positionId: string) {
    return SavingsPosition.findById(positionId).populate('productId').exec();
  }

  /**
   * Withdraw: only when now >= unlockedAt and status is locked.
   * Returns principal + interest and marks position withdrawn. Actual payout is done by treasury/custody.
   */
  async withdraw(positionId: string) {
    const position = await SavingsPosition.findById(positionId).populate('productId').exec();
    if (!position) throw new Error('Position not found');
    if (position.status !== 'locked') throw new Error('Position already withdrawn or invalid');
    const product = position.productId as unknown as { termDays: number; apy: string; asset: { code: string; issuer: string } };
    if (!product) throw new Error('Product not found');

    const now = new Date();
    if (now < position.unlockedAt) throw new Error('Position is still locked');

    const interest = computeInterest(position.amount, product.apy, product.termDays);
    const { netAmount: interestAfterFee, feeAmount: interestFee } = applyPayoutFee(interest);
    const totalPayout = (parseFloat(position.amount) + parseFloat(interestAfterFee)).toFixed(7);

    position.status = 'withdrawn';
    position.interestAccrued = interestAfterFee;
    await position.save();

    return {
      position,
      principal: position.amount,
      interest: interestAfterFee,
      interestFee,
      totalPayout,
      asset: product.asset,
      payoutInstructions: {
        asset: product.asset,
        amount: totalPayout,
        payToUserId: position.userId,
        message: 'Treasury/custody should send totalPayout of asset to the user. 0.6% fee applied on interest.',
      },
    };
  }
}
