import * as StellarSdk from '@stellar/stellar-sdk';
import { server, getAsset } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';
import PoolCache from '../models/PoolCache';

export class PoolService {
  private async ensureTrustline(userSecret: string, assetCode: string, issuer: string) {
    // Native assets don't need trustlines
    if (assetCode === 'native' || !issuer) {
      logger.info(`ℹ️ Skipping trustline for native asset`);
      return;
    }

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
      let fee: string = "100000"; // Default fee: 0.01 Pi
      try {
        const fetchedFee = await server.fetchBaseFee();
        fee = fetchedFee.toString();
      } catch (feeError: any) {
        logger.warn(`⚠️ Failed to fetch base fee, using default (0.01 Pi)`);
      }

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee,
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

      // Clear pool cache after creating a new pool
      PoolCache.deleteMany({}).catch((err: any) => {
        logger.warn(`Failed to clear pool cache after pool creation: ${err?.message || String(err)}`);
      });

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

  public async getLiquidityPools(limit: number = 10, cursor?: string, useCache: boolean = true) {
    // Cache key for all pools (without cursor for first page)
    const cacheKey = cursor ? `all-pools-cursor:${cursor}` : 'all-pools';
    const CACHE_TTL_MS = 300000; // 5 minutes

    // Check cache first
    if (useCache && !cursor) {
      try {
        const cached = await PoolCache.findOne({ 
          cacheKey: 'all-pools',
          expiresAt: { $gt: new Date() }
        });

        if (cached) {
          logger.info(`Using cached pools (from DB, expires: ${cached.expiresAt.toISOString()})`);
          return {
            records: cached.pools,
            nextCursor: undefined // Don't paginate cached data
          };
        }
      } catch (dbError) {
        logger.warn(`Error reading from pool cache DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }

    try {
      let builder = server.liquidityPools().limit(limit);
      if (cursor && cursor.length > 0) {
        const isHexHash = /^[0-9a-f]{64}$/i.test(cursor);
        if (!isHexHash) {
          builder = builder.cursor(cursor);
        } else {
          logger.warn(`⚠️ Cursor looks like a hex hash (pool ID?), skipping cursor. Use paging_token instead.`);
        }
      }

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

      let nextCursor: string | undefined = undefined;
      try {
        if (pools.records.length === limit && pools.paging_token) {
          nextCursor = pools.paging_token;
        }
      } catch (e) {
      }

      if (useCache && !cursor) {
        try {
          const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
          await PoolCache.findOneAndUpdate(
            { cacheKey: 'all-pools' },
            {
              cacheKey: 'all-pools',
              pools: pools.records,
              lastFetched: new Date(),
              expiresAt,
            },
            { upsert: true, new: true }
          );
        } catch (dbError) {
          logger.warn(`Failed to save pool cache to DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        }
      }

      // Filter out empty pools (pools with no liquidity)
      const nonEmptyPools = pools.records.filter((pool: any) => {
        if (!pool || !pool.reserves || pool.reserves.length < 2) {
          return false;
        }
        const [resA, resB] = pool.reserves;
        const amountA = parseFloat(resA.amount || '0');
        const amountB = parseFloat(resB.amount || '0');
        const totalShares = parseFloat(pool.total_shares || '0');
        const MIN_THRESHOLD = 0.0000001;
        
        return !(
          totalShares < MIN_THRESHOLD ||
          (amountA < MIN_THRESHOLD && amountB < MIN_THRESHOLD) ||
          amountA < MIN_THRESHOLD ||
          amountB < MIN_THRESHOLD
        );
      });

      if (nonEmptyPools.length < pools.records.length) {
        logger.info(`🔹 Filtered out ${pools.records.length - nonEmptyPools.length} empty pools`);
      }

      return {
        records: nonEmptyPools,
        nextCursor
      };
    } catch (err: any) {
      if (useCache && !cursor) {
        try {
          const cached = await PoolCache.findOne({ cacheKey: 'all-pools' });
          if (cached && cached.pools.length > 0) {
            logger.warn(`Pool fetch failed, returning cached pools. Error: ${err?.message || String(err)}`);
            return {
              records: cached.pools,
              nextCursor: undefined
            };
          }
        } catch (cacheError) {
        }
      }
      
      logger.error('❌ Error fetching liquidity pools:', JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }

  public async getLiquidityPoolById(liquidityPoolId: string, useCache: boolean = true) {
    if (!liquidityPoolId) {
      throw new Error('liquidityPoolId is required');
    }
    
    const cacheKey = `pool:${liquidityPoolId}`;
    const CACHE_TTL_MS = 300000; // 5 minutes
    
    if (useCache) {
      try {
        const cached = await PoolCache.findOne({ 
          cacheKey,
          expiresAt: { $gt: new Date() }
        });

        if (cached && cached.pools && cached.pools.length > 0) {
          const cachedPool = cached.pools[0];
          logger.info(`Using cached pool ${liquidityPoolId} (from DB, expires: ${cached.expiresAt.toISOString()})`);
          return cachedPool;
        }
      } catch (dbError) {
        logger.warn(`Error reading from pool cache DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }
    
    if (useCache) {
      try {
        const pairCaches = await PoolCache.find({ 
          cacheKey: { $regex: /^pair:/ },
          expiresAt: { $gt: new Date() }
        });
        
        for (const cached of pairCaches) {
          if (cached.pools && Array.isArray(cached.pools)) {
            const foundPool = cached.pools.find((p: any) => p.id === liquidityPoolId);
            if (foundPool) {
              logger.info(`✅ Found pool ${liquidityPoolId} in cached pool list (pair cache)`);
              try {
                const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
                await PoolCache.findOneAndUpdate(
                  { cacheKey },
                  {
                    cacheKey,
                    pools: [foundPool],
                    lastFetched: new Date(),
                    expiresAt,
                  },
                  { upsert: true, new: true }
                );
              } catch (e) {
              }
              return foundPool;
            }
          }
        }
        
        const allPoolsCache = await PoolCache.findOne({ 
          cacheKey: 'all-pools',
          expiresAt: { $gt: new Date() }
        });
        
        if (allPoolsCache && allPoolsCache.pools && Array.isArray(allPoolsCache.pools)) {
          const foundPool = allPoolsCache.pools.find((p: any) => p.id === liquidityPoolId);
          if (foundPool) {
            logger.info(`✅ Found pool ${liquidityPoolId} in cached all-pools list`);
            try {
              const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
              await PoolCache.findOneAndUpdate(
                { cacheKey },
                {
                  cacheKey,
                  pools: [foundPool],
                  lastFetched: new Date(),
                  expiresAt,
                },
                { upsert: true, new: true }
              );
            } catch (e) {
            }
            return foundPool;
          }
        }
      } catch (dbError) {
        logger.warn(`Error searching cached pools: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }
    
    let lastError: any = null;
    const MAX_RETRIES = 2;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          logger.info(`Retrying fetch for pool ${liquidityPoolId} (attempt ${attempt}/${MAX_RETRIES})`);
        } else {
          logger.info(`🔹 Fetching liquidity pool details for ID: ${liquidityPoolId}`);
        }
        
        const pool = await server.liquidityPools().liquidityPoolId(liquidityPoolId).call();
        logger.info(`🔹 Pool found: ${pool.id} | Assets: ${pool.reserves.map((r: any) => r.asset).join(' & ')}`);
        
        if (useCache) {
          try {
            const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
            await PoolCache.findOneAndUpdate(
              { cacheKey },
              {
                cacheKey,
                pools: [pool],
                lastFetched: new Date(),
                expiresAt,
              },
              { upsert: true, new: true }
            );
          } catch (dbError) {
            logger.warn(`Failed to save pool cache to DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
          }
        }
        
        return pool;
      } catch (err: any) {
        lastError = err;
        
        const isNotFoundError =
          err?.response?.status === 404 ||
          err?.constructor?.name === 'NotFoundError' ||
          (err?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found') ||
          (err?.response?.data?.status === 404);
        
        if (isNotFoundError && attempt < MAX_RETRIES) {
          continue;
        } else if (isNotFoundError) {
          if (useCache) {
            try {
              await PoolCache.deleteMany({ cacheKey });
              await PoolCache.updateMany(
                { cacheKey: { $regex: /^pair:/ } },
                { $pull: { pools: { id: liquidityPoolId } } }
              );
            } catch (e) {
            }
          }
          logger.error(`❌ Pool ${liquidityPoolId} not found on Pi Network Horizon after ${MAX_RETRIES} attempts`);
          throw new Error(`Liquidity pool ${liquidityPoolId} not found. The pool may have been removed or dissolved.`);
        } else {
          if (attempt < MAX_RETRIES) {
            continue;
          }
          logger.error(`❌ Error fetching liquidity pool by ID (${liquidityPoolId}):`, JSON.stringify(err.response?.data || err, null, 2));
          throw err;
        }
      }
    }
    
    throw lastError || new Error(`Failed to fetch pool ${liquidityPoolId}`);
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
      
      PoolCache.deleteMany({}).catch((err: any) => {
        logger.warn(`Failed to clear pool cache after adding liquidity: ${err?.message || String(err)}`);
      });
      
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
      
      PoolCache.deleteMany({}).catch((err: any) => {
        logger.warn(`Failed to clear pool cache after removing liquidity: ${err?.message || String(err)}`);
      });
      
      return { hash: result.hash };
    } catch (err: any) {
      logger.error('❌ Error removing liquidity:', JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }

  public async getPoolRewards(userPublicKey: string, poolId: string) {
    try {
      const pool = await this.getLiquidityPoolById(poolId);
      const userAccount = await server.loadAccount(userPublicKey);
  
      const lpBalance = userAccount.balances.find(
        (b: any) => b.liquidity_pool_id === poolId
      );
  
      if (!lpBalance) {
        throw new Error(`User has no shares in liquidity pool ${poolId}`);
      }
  
      const totalShares = parseFloat(pool.total_shares);
      const userShares = parseFloat(lpBalance.balance);
      const userPercentage = userShares / totalShares;
      const rewards = pool.reserves.map((res: any) => ({
        asset: res.asset,
        earnedFees: (parseFloat(res.amount) * userPercentage).toFixed(7),
      }));
  
      logger.info(`💰 Rewards calculated for ${userPublicKey}`);
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

      const lpBalances = account.balances.filter(
        (b: any) => b.liquidity_pool_id
      );
  
      if (lpBalances.length === 0) {
        logger.info(`ℹ️ User has no liquidity pool shares`);
        return [];
      }
      const userPools = [];
      for (const lp of lpBalances) {
        const poolId = lp.liquidity_pool_id;
        try {
          const pool = await this.getLiquidityPoolById(poolId);
          userPools.push({
            poolId,
            userShare: lp.balance,
            totalShares: pool.total_shares,
            assets: pool.reserves.map((r: any) => r.asset),
            reserves: pool.reserves.map((r: any) => `${r.asset}: ${r.amount}`),
            fee: `${pool.fee_bp / 100}%`,
          });
        } catch (e) {
          logger.warn(`⚠️ Unable to fetch pool ${poolId}`);
        }
      }
  
      logger.success(`✅ Found ${userPools.length} user liquidity pools`);
      return userPools;
    } catch (err: any) {
      logger.error(`❌ Error fetching user liquidity pools:`, JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }
 
}
