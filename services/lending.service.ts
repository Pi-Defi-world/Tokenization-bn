import { LendingPool } from '../models/LendingPool';
import { SupplyPosition } from '../models/SupplyPosition';
import { BorrowPosition } from '../models/BorrowPosition';
import { getPriceInPi } from './price.service';
import { applyPayoutFee, PAYOUT_FEE_RATE } from '../config/fees';
import { getBorrowType, getBorrowRateYearly, getBorrowRateMonthly } from '../config/lending';
import { CreditScoreService, applyCreditDiscount } from './credit-score.service';
import { logger } from '../utils/logger';

function add(a: string, b: string): string {
  return (parseFloat(a) + parseFloat(b)).toFixed(7);
}
function sub(a: string, b: string): string {
  return (parseFloat(a) - parseFloat(b)).toFixed(7);
}
function mul(a: string, b: string): string {
  return (parseFloat(a) * parseFloat(b)).toFixed(7);
}

const LIQUIDATION_THRESHOLD = 1.0;
const LIQUIDATION_BONUS = 0.05;

const creditScoreService = new CreditScoreService();

/** Compute accrued interest: principal * rateMonthly * monthsElapsed (monthly interest). */
function computeAccruedInterest(principal: string, rateMonthly: string | undefined, createdAt: Date): string {
  if (!rateMonthly || rateMonthly === '0') return '0';
  const now = new Date();
  const monthsElapsed = Math.max(0, (now.getTime() - createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000));
  const rate = parseFloat(rateMonthly);
  const p = parseFloat(principal);
  return (p * rate * monthsElapsed).toFixed(7);
}

export class LendingService {
  async createPool(params: {
    asset: { code: string; issuer: string };
    supplyRate: string;
    borrowRate: string;
    collateralFactor: string;
    collateralAssets?: { asset: { code: string; issuer: string }; collateralFactor: string }[];
  }) {
    const pool = await LendingPool.create({
      asset: params.asset,
      supplyRate: params.supplyRate,
      borrowRate: params.borrowRate,
      collateralFactor: params.collateralFactor,
      collateralAssets: params.collateralAssets || [],
      totalSupply: '0',
      totalBorrow: '0',
      active: true,
    });
    logger.info(`Lending pool created: ${pool._id}`);
    return pool;
  }

  async listPools(activeOnly = true) {
    const query = activeOnly ? { active: true } : {};
    return LendingPool.find(query).lean().exec();
  }

  async getPool(poolId: string) {
    return LendingPool.findById(poolId).exec();
  }

  async supply(poolId: string, userId: string, amount: string) {
    const pool = await LendingPool.findById(poolId).exec();
    if (!pool || !pool.active) throw new Error('Pool not found or inactive');
    const amountStr = String(amount);
    if (parseFloat(amountStr) <= 0) throw new Error('Amount must be positive');

    const { netAmount, feeAmount } = applyPayoutFee(amountStr);
    let position = await SupplyPosition.findOne({ userId, poolId }).exec();
    if (position) {
      position.amount = add(position.amount, netAmount);
      await position.save();
    } else {
      position = await SupplyPosition.create({ userId, poolId, amount: netAmount });
    }
    pool.totalSupply = add(pool.totalSupply, netAmount);
    await pool.save();
    return { position, feeAmount };
  }

  async withdraw(poolId: string, userId: string, amount: string) {
    const pool = await LendingPool.findById(poolId).exec();
    if (!pool || !pool.active) throw new Error('Pool not found or inactive');
    const position = await SupplyPosition.findOne({ userId, poolId }).exec();
    if (!position) throw new Error('No supply position');
    const amountStr = String(amount);
    const available = parseFloat(pool.totalSupply) - parseFloat(pool.totalBorrow);
    if (parseFloat(amountStr) > parseFloat(position.amount)) throw new Error('Insufficient supplied amount');
    if (parseFloat(amountStr) > available) throw new Error('Cannot withdraw more than available liquidity');

    const { netAmount: amountToUser, feeAmount } = applyPayoutFee(amountStr);
    position.amount = sub(position.amount, amountStr);
    if (parseFloat(position.amount) <= 0) await SupplyPosition.deleteOne({ _id: position._id }).exec();
    else await position.save();
    pool.totalSupply = sub(pool.totalSupply, amountStr);
    await pool.save();
    return { position: position.amount, withdrawn: amountStr, amountToUser, feeAmount };
  }

  async borrow(
    poolId: string,
    userId: string,
    collateralAsset: { code: string; issuer: string },
    collateralAmount: string,
    borrowAmount: string
  ) {
    const pool = await LendingPool.findById(poolId).exec();
    if (!pool || !pool.active) throw new Error('Pool not found or inactive');

    const { allowed, score } = await creditScoreService.canBorrow(userId);
    if (!allowed) throw new Error(`Borrow not allowed: credit score ${score} below minimum`);

    const collConfig = pool.collateralAssets?.find(
      (c) => c.asset.code === collateralAsset.code && c.asset.issuer === collateralAsset.issuer
    );
    const ltv = collConfig ? parseFloat(collConfig.collateralFactor) : parseFloat(pool.collateralFactor);
    if (ltv <= 0) throw new Error('Collateral not accepted');

    const [collPrice, borrowPrice] = await Promise.all([
      getPriceInPi(collateralAsset),
      getPriceInPi(pool.asset),
    ]);
    const collValue = parseFloat(collateralAmount) * parseFloat(collPrice);
    const borrowValue = parseFloat(borrowAmount) * parseFloat(borrowPrice);
    if (collValue * ltv < borrowValue) throw new Error('Insufficient collateral');

    const available = parseFloat(pool.totalSupply) - parseFloat(pool.totalBorrow);
    if (parseFloat(borrowAmount) > available) throw new Error('Insufficient pool liquidity');

    const borrowType = getBorrowType(borrowAmount);
    const baseRateYearly = getBorrowRateYearly(borrowType);
    const effectiveRateYearly = applyCreditDiscount(baseRateYearly, score);
    const rateMonthly = (effectiveRateYearly / 100 / 12).toFixed(7);
    const rateYearlyStr = String(effectiveRateYearly);

    const borrowFeeMultiplier = (1 + PAYOUT_FEE_RATE).toFixed(7);
    const debtAmount = mul(borrowAmount, borrowFeeMultiplier);

    const position = await BorrowPosition.create({
      userId,
      poolId,
      borrowType,
      rateYearly: rateYearlyStr,
      rateMonthly,
      collateralAsset,
      collateralAmount,
      borrowedAmount: debtAmount,
      borrowedAsset: pool.asset,
      accruedInterest: '0',
      healthFactor: (collValue * ltv / borrowValue).toFixed(7),
      liquidatedAt: null,
    });
    pool.totalBorrow = add(pool.totalBorrow, debtAmount);
    await pool.save();
    return {
      position,
      feeAmount: sub(debtAmount, borrowAmount),
      borrowType,
      rateYearlyPercent: effectiveRateYearly,
      rateMonthlyPercent: parseFloat(rateMonthly) * 100,
      creditScore: score,
    };
  }

  async repay(borrowPositionId: string, amount: string) {
    const position = await BorrowPosition.findById(borrowPositionId).populate('poolId').exec();
    if (!position) throw new Error('Borrow position not found');
    if (position.liquidatedAt) throw new Error('Position already liquidated');
    const pool = position.poolId as any;
    const amountStr = String(amount);

    const accrued = computeAccruedInterest(
      position.borrowedAmount,
      position.rateMonthly,
      position.createdAt
    );
    const totalDebt = add(position.borrowedAmount, accrued);
    const repayAmount = parseFloat(amountStr) >= parseFloat(totalDebt) ? totalDebt : amountStr;
    const repayNum = parseFloat(repayAmount);

    const principalRepaid = repayNum > parseFloat(accrued) ? sub(repayAmount, accrued) : '0';
    const newPrincipal = parseFloat(principalRepaid) > 0 ? sub(position.borrowedAmount, principalRepaid) : position.borrowedAmount;

    position.borrowedAmount = newPrincipal;
    position.accruedInterest = '0';
    position.createdAt = new Date();
    if (parseFloat(position.borrowedAmount) <= 0) await BorrowPosition.deleteOne({ _id: position._id }).exec();
    else {
      const [collPrice, borrowPrice] = await Promise.all([
        getPriceInPi(position.collateralAsset),
        getPriceInPi(position.borrowedAsset),
      ]);
      const ltv = parseFloat(pool.collateralFactor);
      const collValue = parseFloat(position.collateralAmount) * parseFloat(collPrice);
      const borrowValue = parseFloat(position.borrowedAmount) * parseFloat(borrowPrice);
      position.healthFactor = borrowValue > 0 ? (collValue * ltv / borrowValue).toFixed(7) : '0';
      await position.save();
    }
    pool.totalBorrow = sub(pool.totalBorrow, principalRepaid);
    await pool.save();
    return { position, repaid: repayAmount, principalRepaid, interestRepaid: sub(repayAmount, principalRepaid) };
  }

  async getPositions(userId: string) {
    const [supply, borrow] = await Promise.all([
      SupplyPosition.find({ userId }).populate('poolId').lean().exec(),
      BorrowPosition.find({ userId, liquidatedAt: null }).populate('poolId').lean().exec(),
    ]);
    const borrowWithAccrued = (borrow as any[]).map((b: any) => {
      const accrued = b.rateMonthly
        ? computeAccruedInterest(b.borrowedAmount, b.rateMonthly, b.createdAt)
        : '0';
      const totalDebt = add(b.borrowedAmount, accrued);
      return { ...b, accruedInterest: accrued, totalDebt };
    });
    return { supply, borrow: borrowWithAccrued };
  }

  async liquidate(borrowPositionId: string, repayAmount: string, liquidatorUserId: string) {
    const position = await BorrowPosition.findById(borrowPositionId).populate('poolId').exec();
    if (!position) throw new Error('Borrow position not found');
    if (position.liquidatedAt) throw new Error('Already liquidated');
    const pool = position.poolId as any;

    const accrued = computeAccruedInterest(
      position.borrowedAmount,
      position.rateMonthly,
      position.createdAt
    );
    const totalDebt = add(position.borrowedAmount, accrued);

    const [collPrice, borrowPrice] = await Promise.all([
      getPriceInPi(position.collateralAsset),
      getPriceInPi(position.borrowedAsset),
    ]);
    const ltv = parseFloat(pool.collateralFactor);
    const collValue = parseFloat(position.collateralAmount) * parseFloat(collPrice);
    const borrowValue = parseFloat(totalDebt) * parseFloat(borrowPrice);
    const healthFactor = borrowValue > 0 ? (collValue * ltv) / borrowValue : 0;
    if (healthFactor >= LIQUIDATION_THRESHOLD) throw new Error('Position is healthy, cannot liquidate');

    const repay = parseFloat(repayAmount);
    if (repay <= 0 || repay > parseFloat(totalDebt)) throw new Error('Invalid repay amount');
    const collateralRewardValue = repay * parseFloat(borrowPrice) / parseFloat(collPrice) * (1 + LIQUIDATION_BONUS);
    const grossCollateralReward = Math.min(collateralRewardValue / parseFloat(collPrice), parseFloat(position.collateralAmount));
    const grossRewardStr = grossCollateralReward.toFixed(7);
    const { netAmount: collateralReward, feeAmount: liquidationFee } = applyPayoutFee(grossRewardStr);

    const principalRepaid = repay > parseFloat(accrued) ? (repay - parseFloat(accrued)).toFixed(7) : '0';
    position.borrowedAmount = sub(position.borrowedAmount, principalRepaid);
    position.collateralAmount = sub(position.collateralAmount, grossRewardStr);
    position.accruedInterest = '0';
    if (parseFloat(position.borrowedAmount) <= 0) position.liquidatedAt = new Date();
    else {
      const newBorrowValue = parseFloat(position.borrowedAmount) * parseFloat(borrowPrice);
      position.healthFactor = newBorrowValue > 0 ? (parseFloat(position.collateralAmount) * parseFloat(collPrice) * ltv / newBorrowValue).toFixed(7) : '0';
    }
    await position.save();
    pool.totalBorrow = sub(pool.totalBorrow, principalRepaid);
    await pool.save();

    return {
      repaid: repayAmount,
      collateralReward,
      collateralAsset: position.collateralAsset,
      liquidatorUserId,
      liquidationFee,
    };
  }
}
