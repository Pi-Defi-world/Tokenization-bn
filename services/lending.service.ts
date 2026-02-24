import { LendingPool } from '../models/LendingPool';
import { SupplyPosition } from '../models/SupplyPosition';
import { BorrowPosition } from '../models/BorrowPosition';
import { getPriceInPi } from './price.service';
import { applyPayoutFee, PAYOUT_FEE_RATE } from '../config/fees';
import { getBorrowType, getBorrowRateYearly, getBorrowRateMonthly } from '../config/lending';
import { CreditScoreService, applyCreditDiscount } from './credit-score.service';
import { logger } from '../utils/logger';
import * as StellarSdk from '@stellar/stellar-sdk';
import { server } from '../config/stellar';
import { getAsset } from '../config/stellar';
import env from '../config/env';
import axios from 'axios';
import { AccountService } from './account.service';
import indicesService from './indices.service';

const accountService = new AccountService();
const User = require('../models/User').default;

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
  /**
   * Supply rate from indices: fundingCost + k * utilization. Optional; pool still uses its own supplyRate by default.
   */
  async getSupplyRateFromUtilization(poolId: string): Promise<number> {
    const fundingCost = await indicesService.getIndex('fundingCost');
    const utilization = await indicesService.getIndex('utilization', { poolId });
    return fundingCost + utilization * 5;
  }

  /**
   * Base borrow rate from indices (before credit discount). Optional; pool still uses env-based rate by default.
   */
  async getBorrowRateBaseFromUtilization(poolId: string): Promise<number> {
    const fundingCost = await indicesService.getIndex('fundingCost');
    const utilization = await indicesService.getIndex('utilization', { poolId });
    return fundingCost + utilization * 8;
  }

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

  async supply(poolId: string, userId: string, amount: string, userSecret: string) {
    const pool = await LendingPool.findById(poolId).exec();
    if (!pool || !pool.active) throw new Error('Pool not found or inactive');
    const amountStr = String(amount);
    if (parseFloat(amountStr) <= 0) throw new Error('Amount must be positive');

    const custodyPublicKey = env.PLATFORM_CUSTODY_PUBLIC_KEY || env.PLATFORM_FEE_PUBLIC_KEY;
    if (!custodyPublicKey?.trim()) throw new Error('Lending custody address not configured (set PLATFORM_ISSUER_SECRET)');

    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = user.publicKey();
    const sourceAccount = await server.loadAccount(publicKey);
    const isNative = pool.asset.code === 'native' || !pool.asset.issuer;
    const paymentAsset = isNative ? StellarSdk.Asset.native() : getAsset(pool.asset.code, pool.asset.issuer || '');

    if (isNative) {
      const nativeBalance = sourceAccount.balances.find((b: any) => b.asset_type === 'native');
      const balance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
      if (balance < parseFloat(amountStr)) throw new Error(`Insufficient balance. You have ${balance} ${pool.asset.code}`);
    } else {
      const tokenBalance = sourceAccount.balances.find(
        (b: any) => b.asset_type !== 'native' && b.asset_code === pool.asset.code && b.asset_issuer === (pool.asset.issuer || '')
      );
      const balance = tokenBalance ? parseFloat(tokenBalance.balance) : 0;
      if (balance < parseFloat(amountStr)) throw new Error(`Insufficient balance. You have ${balance} ${pool.asset.code}`);
    }

    const baseFee = await server.fetchBaseFee();
    const tx = new StellarSdk.TransactionBuilder(sourceAccount, { fee: baseFee.toString(), networkPassphrase: env.NETWORK })
      .addOperation(StellarSdk.Operation.payment({ destination: custodyPublicKey, asset: paymentAsset, amount: amountStr }))
      .setTimeout(60)
      .build();
    tx.sign(user);

    const txXdr = tx.toXDR();
    const response = await axios.post(`${env.HORIZON_URL}/transactions`, `tx=${encodeURIComponent(txXdr)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
    logger.success(`Lending supply tx submitted: ${response.data.hash}`);

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

    accountService.clearBalanceCache(publicKey).catch((err: any) => logger.warn(`Failed to clear balance cache: ${err?.message}`));
    return { position, feeAmount, transactionHash: response.data.hash };
  }

  async withdraw(poolId: string, userId: string, amount: string) {
    const pool = await LendingPool.findById(poolId).exec();
    if (!pool || !pool.active) throw new Error('Pool not found or inactive');
    const position = await SupplyPosition.findOne({ userId, poolId }).exec();
    if (!position) throw new Error('No supply position');
    const amountStr = String(amount);
    const totalSupply = parseFloat(pool.totalSupply);
    const totalBorrow = parseFloat(pool.totalBorrow);
    const reserve = totalSupply * (env.RESERVE_BUFFER_RATIO || 0);
    const available = totalSupply - totalBorrow - reserve;
    if (parseFloat(amountStr) > parseFloat(position.amount)) throw new Error('Insufficient supplied amount');
    if (parseFloat(amountStr) > available) throw new Error('Cannot withdraw more than available liquidity');

    const custodySecret = env.PLATFORM_ISSUER_SECRET;
    if (!custodySecret?.trim()) throw new Error('Platform issuer secret not configured; cannot perform onchain withdraw');

    const userDoc = await User.findById(userId).select('public_key').lean();
    const userPublicKey = userDoc?.public_key;
    if (!userPublicKey?.trim()) throw new Error('User wallet (public_key) not found; connect wallet to withdraw');

    const { netAmount: amountToUser, feeAmount } = applyPayoutFee(amountStr);
    const custodyKeypair = StellarSdk.Keypair.fromSecret(custodySecret);
    const custodyAccount = await server.loadAccount(custodyKeypair.publicKey());
    const isNative = pool.asset.code === 'native' || !pool.asset.issuer;
    const paymentAsset = isNative ? StellarSdk.Asset.native() : getAsset(pool.asset.code, pool.asset.issuer || '');

    const baseFee = await server.fetchBaseFee();
    const tx = new StellarSdk.TransactionBuilder(custodyAccount, { fee: baseFee.toString(), networkPassphrase: env.NETWORK })
      .addOperation(StellarSdk.Operation.payment({ destination: userPublicKey, asset: paymentAsset, amount: amountToUser }))
      .setTimeout(60)
      .build();
    tx.sign(custodyKeypair);

    const response = await axios.post(`${env.HORIZON_URL}/transactions`, `tx=${encodeURIComponent(tx.toXDR())}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
    logger.success(`Lending withdraw tx submitted: ${response.data.hash}`);

    position.amount = sub(position.amount, amountStr);
    if (parseFloat(position.amount) <= 0) await SupplyPosition.deleteOne({ _id: position._id }).exec();
    else await position.save();
    pool.totalSupply = sub(pool.totalSupply, amountStr);
    await pool.save();

    accountService.clearBalanceCache(userPublicKey).catch((err: any) => logger.warn(`Failed to clear balance cache: ${err?.message}`));
    return { position: position.amount, withdrawn: amountStr, amountToUser, feeAmount, transactionHash: response.data.hash };
  }

  async borrow(
    poolId: string,
    userId: string,
    collateralAsset: { code: string; issuer: string },
    collateralAmount: string,
    borrowAmount: string,
    userSecret: string
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

    const totalSupply = parseFloat(pool.totalSupply);
    const totalBorrow = parseFloat(pool.totalBorrow);
    const reserve = totalSupply * (env.RESERVE_BUFFER_RATIO || 0);
    const available = totalSupply - totalBorrow - reserve;
    if (parseFloat(borrowAmount) > available) throw new Error('Insufficient pool liquidity');

    const custodyPublicKey = env.PLATFORM_CUSTODY_PUBLIC_KEY || env.PLATFORM_FEE_PUBLIC_KEY;
    if (!custodyPublicKey?.trim()) throw new Error('Lending custody address not configured (set PLATFORM_ISSUER_SECRET)');

    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const userPublicKey = user.publicKey();
    const userAccount = await server.loadAccount(userPublicKey);

    const collAsset = collateralAsset.code === 'native' || !collateralAsset.issuer
      ? StellarSdk.Asset.native()
      : getAsset(collateralAsset.code, collateralAsset.issuer);
    const baseFee = await server.fetchBaseFee();

    const tx1 = new StellarSdk.TransactionBuilder(userAccount, { fee: baseFee.toString(), networkPassphrase: env.NETWORK })
      .addOperation(StellarSdk.Operation.payment({ destination: custodyPublicKey, asset: collAsset, amount: collateralAmount }))
      .setTimeout(60)
      .build();
    tx1.sign(user);
    const res1 = await axios.post(`${env.HORIZON_URL}/transactions`, `tx=${encodeURIComponent(tx1.toXDR())}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
    logger.success(`Borrow collateral tx submitted: ${res1.data.hash}`);

    const custodySecret = env.PLATFORM_ISSUER_SECRET;
    if (!custodySecret?.trim()) throw new Error('Platform issuer secret not configured; cannot send borrowed asset');
    const custodyKeypair = StellarSdk.Keypair.fromSecret(custodySecret);
    const custodyAccount = await server.loadAccount(custodyKeypair.publicKey());
    const borrowAsset = pool.asset.code === 'native' || !pool.asset.issuer
      ? StellarSdk.Asset.native()
      : getAsset(pool.asset.code, pool.asset.issuer || '');
    const tx2 = new StellarSdk.TransactionBuilder(custodyAccount, { fee: baseFee.toString(), networkPassphrase: env.NETWORK })
      .addOperation(StellarSdk.Operation.payment({ destination: userPublicKey, asset: borrowAsset, amount: borrowAmount }))
      .setTimeout(60)
      .build();
    tx2.sign(custodyKeypair);
    const res2 = await axios.post(`${env.HORIZON_URL}/transactions`, `tx=${encodeURIComponent(tx2.toXDR())}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
    logger.success(`Borrow payout tx submitted: ${res2.data.hash}`);

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

    accountService.clearBalanceCache(userPublicKey).catch((err: any) => logger.warn(`Failed to clear balance cache: ${err?.message}`));
    return {
      position,
      feeAmount: sub(debtAmount, borrowAmount),
      borrowType,
      rateYearlyPercent: effectiveRateYearly,
      rateMonthlyPercent: parseFloat(rateMonthly) * 100,
      creditScore: score,
      transactionHash: res2.data.hash,
    };
  }

  async repay(borrowPositionId: string, amount: string, userSecret: string) {
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

    const custodyPublicKey = env.PLATFORM_CUSTODY_PUBLIC_KEY || env.PLATFORM_FEE_PUBLIC_KEY;
    if (!custodyPublicKey?.trim()) throw new Error('Lending custody address not configured (set PLATFORM_ISSUER_SECRET)');

    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = user.publicKey();
    const sourceAccount = await server.loadAccount(publicKey);
    const borrowedAsset = position.borrowedAsset as { code: string; issuer: string };
    const isNative = borrowedAsset.code === 'native' || !borrowedAsset.issuer;
    const paymentAsset = isNative ? StellarSdk.Asset.native() : getAsset(borrowedAsset.code, borrowedAsset.issuer || '');

    const baseFee = await server.fetchBaseFee();
    const tx = new StellarSdk.TransactionBuilder(sourceAccount, { fee: baseFee.toString(), networkPassphrase: env.NETWORK })
      .addOperation(StellarSdk.Operation.payment({ destination: custodyPublicKey, asset: paymentAsset, amount: repayAmount }))
      .setTimeout(60)
      .build();
    tx.sign(user);

    const response = await axios.post(`${env.HORIZON_URL}/transactions`, `tx=${encodeURIComponent(tx.toXDR())}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
    logger.success(`Lending repay tx submitted: ${response.data.hash}`);

    const repayNum = parseFloat(repayAmount);
    const principalRepaid = repayNum > parseFloat(accrued) ? sub(repayAmount, accrued) : '0';
    const newPrincipal = parseFloat(principalRepaid) > 0 ? sub(position.borrowedAmount, principalRepaid) : position.borrowedAmount;

    position.borrowedAmount = newPrincipal;
    position.accruedInterest = '0';
    position.createdAt = new Date();
    if (parseFloat(position.borrowedAmount) <= 0) {
      (position as any).repaidAt = new Date();
      await position.save();
    } else {
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

    accountService.clearBalanceCache(publicKey).catch((err: any) => logger.warn(`Failed to clear balance cache: ${err?.message}`));
    return { position, repaid: repayAmount, principalRepaid, interestRepaid: sub(repayAmount, principalRepaid), transactionHash: response.data.hash };
  }

  async getPositions(userId: string) {
    const [supply, borrow] = await Promise.all([
      SupplyPosition.find({ userId }).populate('poolId').lean().exec(),
      BorrowPosition.find({ userId, liquidatedAt: null, $or: [{ repaidAt: { $exists: false } }, { repaidAt: null }] }).populate('poolId').lean().exec(),
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

  async liquidate(borrowPositionId: string, repayAmount: string, liquidatorUserId: string, liquidatorSecret: string) {
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

    const custodyPublicKey = env.PLATFORM_CUSTODY_PUBLIC_KEY || env.PLATFORM_FEE_PUBLIC_KEY;
    const custodySecret = env.PLATFORM_ISSUER_SECRET;
    if (!custodySecret?.trim()) throw new Error('Platform issuer secret not configured; cannot perform onchain liquidation');

    const liquidatorKeypair = StellarSdk.Keypair.fromSecret(liquidatorSecret);
    const liquidatorPublicKey = liquidatorKeypair.publicKey();

    const borrowedAsset = position.borrowedAsset as { code: string; issuer: string };
    const collateralAsset = position.collateralAsset as { code: string; issuer: string };
    const borrowAssetStellar = borrowedAsset.code === 'native' || !borrowedAsset.issuer
      ? StellarSdk.Asset.native()
      : getAsset(borrowedAsset.code, borrowedAsset.issuer);
    const collAssetStellar = collateralAsset.code === 'native' || !collateralAsset.issuer
      ? StellarSdk.Asset.native()
      : getAsset(collateralAsset.code, collateralAsset.issuer);

    const baseFee = await server.fetchBaseFee();

    const liquidatorAccount = await server.loadAccount(liquidatorPublicKey);
    const tx1 = new StellarSdk.TransactionBuilder(liquidatorAccount, { fee: baseFee.toString(), networkPassphrase: env.NETWORK })
      .addOperation(StellarSdk.Operation.payment({ destination: custodyPublicKey, asset: borrowAssetStellar, amount: repayAmount }))
      .setTimeout(60)
      .build();
    tx1.sign(liquidatorKeypair);
    const res1 = await axios.post(`${env.HORIZON_URL}/transactions`, `tx=${encodeURIComponent(tx1.toXDR())}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
    logger.success(`Liquidation repay tx submitted: ${res1.data.hash}`);

    const custodyKeypair = StellarSdk.Keypair.fromSecret(custodySecret);
    const custodyAccount = await server.loadAccount(custodyKeypair.publicKey());
    const tx2 = new StellarSdk.TransactionBuilder(custodyAccount, { fee: baseFee.toString(), networkPassphrase: env.NETWORK })
      .addOperation(StellarSdk.Operation.payment({ destination: liquidatorPublicKey, asset: collAssetStellar, amount: collateralReward }))
      .setTimeout(60)
      .build();
    tx2.sign(custodyKeypair);
    const res2 = await axios.post(`${env.HORIZON_URL}/transactions`, `tx=${encodeURIComponent(tx2.toXDR())}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    });
    logger.success(`Liquidation collateral payout tx submitted: ${res2.data.hash}`);

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

    accountService.clearBalanceCache(liquidatorPublicKey).catch((err: any) => logger.warn(`Failed to clear balance cache: ${err?.message}`));

    return {
      repaid: repayAmount,
      collateralReward,
      collateralAsset: position.collateralAsset,
      liquidatorUserId,
      liquidationFee,
      transactionHashRepay: res1.data.hash,
      transactionHashCollateral: res2.data.hash,
    };
  }
}
