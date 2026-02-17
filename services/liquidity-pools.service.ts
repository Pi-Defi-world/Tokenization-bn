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

      const lastRecord = pools.records[pools.records.length - 1];
      // Horizon responses typically expose paging_token on each record
      const nextCursor = lastRecord?.paging_token as string | undefined;

      return {
        records: pools.records,
        nextCursor
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
      logger.error(
        `❌ Error fetching liquidity pool by ID (${liquidityPoolId}):`,
        JSON.stringify(err.response?.data || err, null, 2)
      );
      throw err;
    }
  }
  public async addLiquidity(
    userSecret: string,
    poolId: string,
    amountA: string,
    amountB: string
  ) {
    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const account = await server.loadAccount(user.publicKey());
      const pool = await this.getLiquidityPoolById(poolId);

      const [resA, resB] = pool.reserves;
      if (parseFloat(pool.total_shares) === 0) {
        logger.warn(`⚠️ Pool ${poolId} is empty. Reinitializing liquidity...`);
        return await this.createLiquidityPool(
          userSecret,
          { code: resA.asset.split(':')[0], issuer: resA.asset.split(':')[1] },
          { code: resB.asset.split(':')[0], issuer: resB.asset.split(':')[1] },
          amountA,
          amountB
        );
      }
      const exactPrice = parseFloat(resA.amount) / parseFloat(resB.amount);
      const minPrice = (exactPrice * 0.9).toFixed(7);
      const maxPrice = (exactPrice * 1.1).toFixed(7);

      const baseFee = await server.fetchBaseFee();

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
      logger.success(`✅ Added liquidity successfully`);
      return { hash: result.hash };
    } catch (err: any) {
      logger.error('❌ Error adding liquidity:', JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }

  public async removeLiquidity(userSecret: string, poolId: string, shareAmount: string) {
    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const account = await server.loadAccount(user.publicKey());
      const pool = await this.getLiquidityPoolById(poolId);

      const [resA, resB] = pool.reserves;
      const shareRatio = parseFloat(shareAmount) / parseFloat(pool.total_shares);

      
      const minAmountA = (parseFloat(resA.amount) * shareRatio * 0.99).toFixed(7);
      const minAmountB = (parseFloat(resB.amount) * shareRatio * 0.99).toFixed(7);

      const baseFee = await server.fetchBaseFee();

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: baseFee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.liquidityPoolWithdraw({
            liquidityPoolId: poolId,
            amount: shareAmount,
            minAmountA,
            minAmountB,
          })
        )
        .setTimeout(60)
        .build();

      tx.sign(user);
      const result = await server.submitTransaction(tx);
      logger.success(`💧 Liquidity withdrawn successfully`);
      return { hash: result.hash };
    } catch (err: any) {
      logger.error('❌ Error removing liquidity:', JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }

  public async getPoolRewards(userPublicKey: string, poolId: string) {
    try {
      // Fetch pool and user account info
      const pool = await this.getLiquidityPoolById(poolId);
      const userAccount = await server.loadAccount(userPublicKey);
  
      // Find user's LP balance (shares)
      const lpBalance = userAccount.balances.find(
        (b: any) => b.liquidity_pool_id === poolId
      );
  
      if (!lpBalance) {
        throw new Error(`User has no shares in liquidity pool ${poolId}`);
      }
  
      const totalShares = parseFloat(pool.total_shares);
      const userShares = parseFloat(lpBalance.balance);
      const userPercentage = userShares / totalShares;
  
      // Calculate proportional rewards
      const rewards = pool.reserves.map((res: any) => ({
        asset: res.asset,
        earnedFees: (parseFloat(res.amount) * userPercentage).toFixed(7),
      }));
  
      logger.info(`� Rewards calculated for ${userPublicKey}`);
      return { poolId, userShares, totalShares, userPercentage, rewards };
    } catch (err: any) {
      logger.error('❌ Error fetching pool rewards:', JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }

  public async getUserLiquidityPools(userPublicKey: string) {
    try {
      logger.info(`🔹 Fetching liquidity pools for user: ${userPublicKey}`);

      const account = await server.loadAccount(userPublicKey);

       const lpBalances = account.balances.filter((b: any) => b.liquidity_pool_id);

      if (lpBalances.length === 0) {
        logger.info(`🔵 User has no liquidity pool shares`);
        return [];
      }

      const poolPromises = lpBalances.map(async (lp: any) => {
        const poolId = lp.liquidity_pool_id;
        try {
          const pool = await this.getLiquidityPoolById(poolId);
          return {
            poolId,
            userShare: lp.balance,
            totalShares: pool.total_shares,
            assets: pool.reserves.map((r: any) => r.asset),
            reserves: pool.reserves.map((r: any) => `${r.asset}: ${r.amount}`),
            fee: `${pool.fee_bp / 100}%`,
          };
        } catch (e) {
          logger.warn(`⚠️ Unable to fetch pool ${poolId}`);
          return null;
        }
      });

      const userPools = (await Promise.all(poolPromises)).filter(Boolean) as any[];

      logger.success(`🔵 Found ${userPools.length} user liquidity pools`);
      return userPools;
    } catch (err: any) {
      logger.error(
        `🔴 Error fetching user liquidity pools:`,
        JSON.stringify(err.response?.data || err, null, 2)
      );
      throw err;
    }
  }
 
}
