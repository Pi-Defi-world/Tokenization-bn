import { SavingsProduct } from '../models/SavingsProduct';
import { SavingsPosition } from '../models/SavingsPosition';
import { applyPayoutFee } from '../config/fees';
import { logger } from '../utils/logger';
import indicesService from './indices.service';
import * as StellarSdk from '@stellar/stellar-sdk';
import { server } from '../config/stellar';
import { getAsset } from '../config/stellar';
import env from '../config/env';
import axios from 'axios';
import { AccountService } from './account.service';

const accountService = new AccountService();
const User = require('../models/User').default;

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

type ProductLike = { termDays: number; apy: string };
type PositionLike = { amount: string; unlockedAt: Date; apyAtDeposit?: string };

/**
 * Accrued interest at a given date. Returns 0 if asOf < unlockedAt; otherwise full term interest using apyAtDeposit or product.apy.
 */
function getAccruedInterest(position: PositionLike, product: ProductLike, asOf: Date = new Date()): string {
  if (asOf < position.unlockedAt) return '0';
  const apy = position.apyAtDeposit || product.apy;
  return computeInterest(position.amount, apy, product.termDays);
}

export class SavingsService {
  /**
   * Resolve savings APY for a term from indices (baseRate + termPremium).
   */
  async getSavingsApy(termDays: number): Promise<string> {
    const baseRate = await indicesService.getIndex('baseRate');
    const termPremium = await indicesService.getIndex('termPremium', { termDays });
    return (baseRate + termPremium).toFixed(2);
  }

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

  /**
   * Total locked savings (sum of amount over positions with status locked). For fund segmentation reporting.
   */
  async getTotalSavings(): Promise<string> {
    const result = await SavingsPosition.aggregate([
      { $match: { status: 'locked' } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$amount' } } } },
    ]).exec();
    const total = result[0]?.total ?? 0;
    return total.toFixed(7);
  }

  /** Term options with current APY for display before deposit (time and date). */
  async getTermOptions(): Promise<{ days: number; apy: string; unlockDate: string }[]> {
    const { TERM_DAYS } = await import('../config/savings');
    const now = new Date();
    const options: { days: number; apy: string; unlockDate: string }[] = [];
    for (const days of TERM_DAYS) {
      const apy = await this.getSavingsApy(days);
      const unlock = new Date(now);
      unlock.setDate(unlock.getDate() + days);
      options.push({ days, apy, unlockDate: unlock.toISOString() });
    }
    return options;
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
   * Deposit: user signs payment to savings custody address; on success a locked position is created.
   * Requires userSecret so the backend can build and submit the Stellar payment (same pattern as send/swap).
   */
  async deposit(params: {
    userId: string;
    productId: string;
    amount: string;
    userSecret: string;
    depositAddress?: string;
    /** When product has termOptions, the selected term in days (e.g. 40, 60, 90, 365, 730, 1825). */
    termDays?: number;
  }) {
    const product = await SavingsProduct.findById(params.productId).exec();
    if (!product) throw new Error('Savings product not found');
    if (!product.active) throw new Error('Product is not active');
    const amountNum = parseFloat(params.amount);
    const minNum = parseFloat(product.minAmount);
    if (isNaN(amountNum) || amountNum < minNum) throw new Error(`Amount must be >= ${product.minAmount}`);
    const termDays = params.termDays ?? product.termDays;

    const custodyPublicKey = env.PLATFORM_CUSTODY_PUBLIC_KEY || env.PLATFORM_FEE_PUBLIC_KEY;
    if (!custodyPublicKey || custodyPublicKey.trim() === '') {
      throw new Error('Savings custody address not configured (set PLATFORM_ISSUER_SECRET)');
    }

    const user = StellarSdk.Keypair.fromSecret(params.userSecret);
    const publicKey = user.publicKey();

    const sourceAccount = await server.loadAccount(publicKey);
    const isNative = product.asset.code === 'native' || !product.asset.issuer;
    const paymentAsset = isNative
      ? StellarSdk.Asset.native()
      : getAsset(product.asset.code, product.asset.issuer || '');

    if (isNative) {
      const nativeBalance = sourceAccount.balances.find((b: any) => b.asset_type === 'native');
      const balance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
      if (balance < amountNum) {
        throw new Error(`Insufficient balance. You have ${balance} ${product.asset.code}`);
      }
    } else {
      const tokenBalance = sourceAccount.balances.find(
        (b: any) => b.asset_type !== 'native' && b.asset_code === product.asset.code && b.asset_issuer === (product.asset.issuer || '')
      );
      const balance = tokenBalance ? parseFloat(tokenBalance.balance) : 0;
      if (balance < amountNum) {
        throw new Error(`Insufficient balance. You have ${balance} ${product.asset.code}`);
      }
    }

    const baseFee = await server.fetchBaseFee();
    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: baseFee.toString(),
      networkPassphrase: env.NETWORK,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: custodyPublicKey,
          asset: paymentAsset,
          amount: params.amount,
        })
      )
      .setTimeout(60)
      .build();
    tx.sign(user);

    const txXdr = tx.toXDR();
    const submitUrl = `${env.HORIZON_URL}/transactions`;
    const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });

    logger.success(`Savings deposit tx submitted: ${response.data.hash}`);

    const depositedAt = new Date();
    const unlockedAt = new Date(depositedAt);
    unlockedAt.setDate(unlockedAt.getDate() + termDays);

    const apyAtDeposit = (await this.getSavingsApy(termDays)) || product.apy;

    const position = await SavingsPosition.create({
      userId: params.userId,
      productId: params.productId,
      amount: params.amount,
      depositedAt,
      unlockedAt,
      status: 'locked',
      apyAtDeposit,
    });

    accountService.clearBalanceCache(publicKey).catch((err: any) => {
      logger.warn(`Failed to clear balance cache after savings deposit: ${err?.message || String(err)}`);
    });

    return {
      position,
      unlockedAt,
      transactionHash: response.data.hash,
      ledger: response.data.ledger,
    };
  }

  async listPositions(userId: string, status?: 'locked' | 'withdrawn') {
    const query: Record<string, unknown> = { userId };
    if (status) query.status = status;
    const positions = await SavingsPosition.find(query).populate('productId').sort({ createdAt: -1 }).lean().exec();
    return positions.map((p) => this.enrichPositionWithAccrued(p));
  }

  async getPosition(positionId: string) {
    const position = await SavingsPosition.findById(positionId).populate('productId').lean().exec();
    if (!position) return null;
    return this.enrichPositionWithAccrued(position);
  }

  /**
   * Add accruedInterestSoFar, projectedInterestAtUnlock, and depositedAt to a position for API responses.
   */
  enrichPositionWithAccrued(position: any) {
    const product = position.productId;
    if (!product) return { ...position, accruedInterestSoFar: '0', projectedInterestAtUnlock: '0', depositedAt: position.depositedAt ?? position.createdAt };
    const depositedAt = position.depositedAt ? new Date(position.depositedAt) : (position.createdAt ? new Date(position.createdAt) : new Date());
    const now = new Date();
    const accruedInterestSoFar = getAccruedInterest(
      { amount: position.amount, unlockedAt: new Date(position.unlockedAt), apyAtDeposit: position.apyAtDeposit },
      { termDays: product.termDays, apy: product.apy },
      now
    );
    const projectedInterestAtUnlock = computeInterest(position.amount, position.apyAtDeposit || product.apy, product.termDays);
    return {
      ...position,
      depositedAt: position.depositedAt ?? position.createdAt,
      accruedInterestSoFar,
      projectedInterestAtUnlock,
    };
  }

  /**
   * Withdraw: only when now >= unlockedAt and status is locked.
   * Custody sends principal + interest to user onchain; position marked withdrawn.
   */
  async withdraw(positionId: string) {
    const position = await SavingsPosition.findById(positionId).populate('productId').exec();
    if (!position) throw new Error('Position not found');
    if (position.status !== 'locked') throw new Error('Position already withdrawn or invalid');
    const product = position.productId as unknown as { termDays: number; apy: string; asset: { code: string; issuer: string } };
    if (!product) throw new Error('Product not found');

    const now = new Date();
    if (now < position.unlockedAt) throw new Error('Position is still locked');

    const apy = (position as any).apyAtDeposit || product.apy;
    const interest = computeInterest(position.amount, apy, product.termDays);
    const { netAmount: interestAfterFee, feeAmount: interestFee } = applyPayoutFee(interest);
    const totalPayout = (parseFloat(position.amount) + parseFloat(interestAfterFee)).toFixed(7);

    const userDoc = await User.findById(position.userId).select('public_key').lean().exec();
    const userPublicKey = userDoc?.public_key;
    if (!userPublicKey?.trim()) throw new Error('User wallet (public_key) not found; connect wallet to withdraw');

    const custodySecret = env.PLATFORM_ISSUER_SECRET;
    if (!custodySecret?.trim()) throw new Error('Platform issuer secret not configured; cannot perform onchain withdraw');

    const isNative = product.asset.code === 'native' || !product.asset.issuer;
    const paymentAsset = isNative ? StellarSdk.Asset.native() : getAsset(product.asset.code, product.asset.issuer || '');
    const custodyKeypair = StellarSdk.Keypair.fromSecret(custodySecret);
    const custodyAccount = await server.loadAccount(custodyKeypair.publicKey());

    const baseFee = await server.fetchBaseFee();
    const tx = new StellarSdk.TransactionBuilder(custodyAccount, { fee: baseFee.toString(), networkPassphrase: env.NETWORK })
      .addOperation(StellarSdk.Operation.payment({ destination: userPublicKey, asset: paymentAsset, amount: totalPayout }))
      .setTimeout(60)
      .build();
    tx.sign(custodyKeypair);

    const response = await axios.post(`${env.HORIZON_URL}/transactions`, `tx=${encodeURIComponent(tx.toXDR())}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
    logger.success(`Savings withdraw tx submitted: ${response.data.hash}`);

    position.status = 'withdrawn';
    position.interestAccrued = interestAfterFee;
    await position.save();

    accountService.clearBalanceCache(userPublicKey).catch((err: any) => logger.warn(`Failed to clear balance cache: ${err?.message}`));

    return {
      position,
      principal: position.amount,
      interest: interestAfterFee,
      interestFee,
      totalPayout,
      asset: product.asset,
      transactionHash: response.data.hash,
    };
  }
}
