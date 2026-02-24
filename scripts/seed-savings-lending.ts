/**
 * Seed script: creates one Pi savings product and one Pi lending pool.
 * Lending pool: native Pi (supply/borrow), collateral = zyradex02 (platform token) only if it exists on-chain.
 * Run: pnpm run seed:savings-lending
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import * as StellarSdk from '@stellar/stellar-sdk';

import env from '../config/env';
import { server } from '../config/stellar';
import { LendingPool } from '../models/LendingPool';
import { SavingsProduct } from '../models/SavingsProduct';
import { LendingService } from '../services/lending.service';
import { SavingsService } from '../services/savings.service';
import { assetExistsOnChain } from '../utils/asset';
import { logger } from '../utils/logger';

dotenv.config();

const NATIVE_PI = { code: 'native', issuer: '' };

async function seed() {
  const mongoURI = env.MONGO_URI;
  if (!mongoURI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }
  if (!env.PLATFORM_ISSUER_SECRET) {
    throw new Error('PLATFORM_ISSUER_SECRET is not defined in environment variables');
  }

  await mongoose.connect(mongoURI);
  logger.info('Connected to MongoDB');

  const platformIssuer = StellarSdk.Keypair.fromSecret(env.PLATFORM_ISSUER_SECRET).publicKey();
  const lendingService = new LendingService();
  const savingsService = new SavingsService();

  const zyradex02Asset = { code: 'zyradex02', issuer: platformIssuer };
  let collateralAssets: { asset: { code: string; issuer: string }; collateralFactor: string }[] = [];
  const exists = await assetExistsOnChain(server, zyradex02Asset);
  if (exists) {
    collateralAssets = [
      { asset: zyradex02Asset, collateralFactor: '0.8' },
    ];
    logger.info('zyradex02 found on-chain; using as collateral for lending pool.');
  } else {
    logger.info('zyradex02 not found on this network (e.g. token is on production only). Creating pool without zyradex02 collateral.');
  }

  // Idempotency: skip if native Pi pool already exists
  const existingPool = await LendingPool.findOne({
    'asset.code': NATIVE_PI.code,
    'asset.issuer': NATIVE_PI.issuer,
  }).exec();
  if (existingPool) {
    logger.info(`Lending pool for native Pi already exists: ${existingPool._id}. Skipping pool creation.`);
  } else {
    const pool = await lendingService.createPool({
      asset: NATIVE_PI,
      supplyRate: '5',
      borrowRate: '12',
      collateralFactor: '0.8',
      collateralAssets,
    });
    logger.info(`Lending pool created: ${pool._id}`);
  }

  // Idempotency: skip if native Pi savings product already exists
  const existingProduct = await SavingsProduct.findOne({
    'asset.code': NATIVE_PI.code,
    'asset.issuer': NATIVE_PI.issuer,
  }).exec();
  if (existingProduct) {
    logger.info(`Savings product for native Pi already exists: ${existingProduct._id}. Skipping product creation.`);
  } else {
    const product = await savingsService.createProduct({
      asset: NATIVE_PI,
      termDays: 90,
      apy: '6',
      minAmount: '0',
    });
    logger.info(`Savings product created: ${product._id}`);
  }

  await mongoose.disconnect();
  logger.info('Disconnected from MongoDB');
}

if (require.main === module) {
  seed()
    .then(() => {
      logger.info('Seed script completed');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Seed script failed:', err?.message || err);
      process.exit(1);
    });
}

export { seed };
