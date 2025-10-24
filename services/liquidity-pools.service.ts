import * as StellarSdk from '@stellar/stellar-sdk';
import { server, getAsset } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';

export class PoolService {
  private async ensureTrustline(userSecret: string, assetCode: string, issuer: string) {
    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const publicKey = user.publicKey();

      logger.info(`🔹 Checking trustline for ${assetCode} (${issuer}) on ${publicKey}`);

      const account = await server.loadAccount(publicKey);

      const trustlineExists = account.balances.some(
        (b: any) => b.asset_code === assetCode && b.asset_issuer === issuer
      );

      if (trustlineExists) {
        logger.info(`✅ Trustline for ${assetCode} already exists`);
        return;
      }

      logger.info(`🔹 Creating trustline for ${assetCode}`);

      const asset = getAsset(assetCode, issuer);
      const baseFee = await server.fetchBaseFee();

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: baseFee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.changeTrust({
            asset,
            limit: '10000000000',
          })
        )
        .setTimeout(60)
        .build();

      tx.sign(user);
      const res = await server.submitTransaction(tx);
      logger.success(`✅ Trustline established for ${assetCode}`);
      logger.info(`🔹 TX hash: ${res.hash}`);
    } catch (err: any) {
      logger.error(`❌ Error ensuring trustline:`, JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }

  public async createLiquidityPool(
    userSecret: string,
    tokenA: { code: string; issuer: string },
    tokenB: { code: string; issuer: string },
    amountA: string,
    amountB: string
  ) {
    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const publicKey = user.publicKey();

      logger.info(`🔹 Creating liquidity pool for user: ${publicKey}`);
      logger.info(`🔹 Token A: ${tokenA.code}, Token B: ${tokenB.code}`);

      await this.ensureTrustline(userSecret, tokenA.code, tokenA.issuer);
      await this.ensureTrustline(userSecret, tokenB.code, tokenB.issuer);

      const account = await server.loadAccount(publicKey);

      const assetA =
        tokenA.code === 'native'
          ? StellarSdk.Asset.native()
          : new StellarSdk.Asset(tokenA.code, tokenA.issuer);

      const assetB =
        tokenB.code === 'native'
          ? StellarSdk.Asset.native()
          : new StellarSdk.Asset(tokenB.code, tokenB.issuer);

      const poolShareAsset = new StellarSdk.LiquidityPoolAsset(
        assetA,
        assetB,
        StellarSdk.LiquidityPoolFeeV18
      );

      const poolId = StellarSdk.getLiquidityPoolId(
        'constant_product',
        poolShareAsset.getLiquidityPoolParameters()
      ).toString('hex');

      logger.info(`🔹 Liquidity Pool ID (hex): ${poolId}`);

      const baseFee = await server.fetchBaseFee();
      logger.info(`🔹 Ensuring trustline for pool share asset...`);

      const trustTx = new StellarSdk.TransactionBuilder(account, {
        fee: baseFee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.changeTrust({
            asset: poolShareAsset,
            limit: '1000000000',
          })
        )
        .setTimeout(60)
        .build();

      trustTx.sign(user);
      const trustRes = await server.submitTransaction(trustTx);
      logger.success(`✅ Trustline established for pool share asset`);
      logger.info(`🔹 Trustline TX hash: ${trustRes.hash}`);

      const exactPrice = parseFloat(amountA) / parseFloat(amountB);
      const minPrice = (exactPrice * 0.9).toFixed(7);
      const maxPrice = (exactPrice * 1.1).toFixed(7);

      logger.info(`🔹 Price range: exact=${exactPrice}, min=${minPrice}, max=${maxPrice}`);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: baseFee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.liquidityPoolDeposit({
            liquidityPoolId: poolId,
            maxAmountA: amountA,
            maxAmountB: amountB,
            minPrice,
            maxPrice,
          })
        )
        .setTimeout(60)
        .build();

      tx.sign(user);
      const result = await server.submitTransaction(tx);

      logger.success(`🚀 Liquidity pool created and liquidity added successfully!`);
      logger.info(`🔹 Pool ID: ${poolId}`);
      logger.info(`🔹 TX hash: ${result.hash}`);

      return {
        poolId,
        liquidityTxHash: result.hash,
      };
    } catch (err: any) {
      logger.error('❌ Error creating liquidity pool:');
      logger.error(err.response?.data.extras.result_codes.operations[0]);
      throw err.response?.data.extras.result_codes.operations[0];
    }
  }

  public async getLiquidityPools(limit: number = 10, cursor?: string) {
    try {
      let builder = server.liquidityPools().limit(limit);
      if (cursor) builder = builder.cursor(cursor);

      const pools = await builder.call();

      logger.info(`🔹 Fetched ${pools.records.length} liquidity pools`);
      pools.records.forEach((pool: any, i: number) => {
        logger.info(
          [
            `#${i + 1} Pool ID: ${pool.id}`,
            `Assets: ${pool.reserves.map((r: any) => r.asset).join(' & ')}`,
            `Total Shares: ${pool.total_shares}`,
            `Fee: ${pool.fee_bp / 100}%`,
            `Reserves: ${pool.reserves.map((r: any) => `${r.asset}: ${r.amount}`).join(', ')}`
          ].join(' | ')
        );
      });

      logger.info(`🔹 Next page function available via pools.next()`);
      return {
        records: pools.records,
        next: pools.next
      };
    } catch (err: any) {
      logger.error('❌ Error fetching liquidity pools:', JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }

  public async getLiquidityPoolById(liquidityPoolId: string) {
    try {
      if (!liquidityPoolId) {
        throw new Error('liquidityPoolId is required');
      }
      logger.info(`🔹 Fetching liquidity pool details for ID: ${liquidityPoolId}`);
      const pool = await server.liquidityPools().liquidityPoolId(liquidityPoolId).call();
      logger.info(`🔹 Pool found: ${pool.id} | Assets: ${pool.reserves.map((r: any) => r.asset).join(' & ')}`);
      return pool;
    } catch (err: any) {
      logger.error(`❌ Error fetching liquidity pool by ID (${liquidityPoolId}):`, JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }
}
