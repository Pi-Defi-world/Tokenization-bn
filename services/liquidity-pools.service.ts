import * as StellarSdk from '@stellar/stellar-sdk';
import { server, getAsset } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';
import PoolCache from '../models/PoolCache';
import { Pair } from '../models/Pair';
import { AccountService } from './account.service';
import axios from 'axios';
import { horizonQueue } from '../utils/horizon-queue';

export class PoolService {
  private accountService: AccountService;

  constructor() {
    this.accountService = new AccountService();
  }

  private isPoolEmpty(pool: any): boolean {
    if (!pool || !pool.reserves || pool.reserves.length < 2) {
      return true;
    }
    
    const [resA, resB] = pool.reserves;
    const amountA = parseFloat(resA.amount || '0');
    const amountB = parseFloat(resB.amount || '0');
    const totalShares = parseFloat(pool.total_shares || '0');
    
    // Pool is empty if:
    // - Total shares is 0 or very close to 0
    // - OR both reserves are 0 or very close to 0
    // - OR any reserve is 0 or very close to 0
    const MIN_THRESHOLD = 0.0000001; // Very small threshold to account for floating point precision
    
    return (
      totalShares < MIN_THRESHOLD ||
      (amountA < MIN_THRESHOLD && amountB < MIN_THRESHOLD) ||
      amountA < MIN_THRESHOLD ||
      amountB < MIN_THRESHOLD
    );
  }

  private async ensureTrustline(userSecret: string, assetCode: string, issuer: string) {
    // Native assets don't need trustlines
    if (assetCode === 'native' || !issuer) {
      logger.info(`ℹ️ Skipping trustline for native asset`);
      return;
    }

    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const publicKey = user.publicKey();


      const account = await server.loadAccount(publicKey);

      const trustlineExists = account.balances.some(
        (b: any) => b.asset_code === assetCode && b.asset_issuer === issuer
      );

      if (trustlineExists) {
        return;
      }


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
      
      // Submit transaction using direct HTTP (workaround for SDK URL construction bug)
      const txXdr = tx.toXDR();
      const submitUrl = `${env.HORIZON_URL}/transactions`;
      
      const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      });
      
      const res = {
        hash: response.data.hash,
        ledger: response.data.ledger,
        envelope_xdr: response.data.envelope_xdr,
        result_xdr: response.data.result_xdr,
        result_meta_xdr: response.data.result_meta_xdr,
      };
      
      logger.success(`✅ Trustline established for ${assetCode}`);
    } catch (err: any) {
      logger.error(`❌ Error ensuring trustline:`, err);
      throw err;
    }
  }

  public async checkPoolExists(
    tokenA: { code: string; issuer: string },
    tokenB: { code: string; issuer: string },
    useCache: boolean = true
  ): Promise<{ exists: boolean; pool?: any; poolId?: string } | null> {
    try {
      // Normalize token codes for cache key
      const tokenACode = tokenA.code === 'native' ? 'native' : tokenA.code.toUpperCase();
      const tokenBCode = tokenB.code === 'native' ? 'native' : tokenB.code.toUpperCase();
      
      // Check both directions (A/B and B/A) since pools can be created either way
      const cacheKey1 = `pair:${tokenACode}:${tokenBCode}`;
      const cacheKey2 = `pair:${tokenBCode}:${tokenACode}`;
      const CACHE_TTL_MS = 300000; // 5 minutes

      // Check cache first
      if (useCache) {
        try {
          // Try first direction
          let cached = await PoolCache.findOne({ 
            cacheKey: cacheKey1,
            expiresAt: { $gt: new Date() }
          })
          .select('pools expiresAt')
          .lean();

          // If not found, try reverse direction
          if (!cached) {
            cached = await PoolCache.findOne({ 
              cacheKey: cacheKey2,
              expiresAt: { $gt: new Date() }
            })
            .select('pools expiresAt')
            .lean();
          }

          if (cached && cached.pools && Array.isArray(cached.pools) && cached.pools.length > 0) {
            // Filter out empty pools
            const nonEmptyPools = cached.pools.filter((pool: any) => !this.isPoolEmpty(pool));
            
            if (nonEmptyPools.length > 0) {
              // Find the pool that matches both tokens exactly
              for (const pool of nonEmptyPools) {
                const assets = pool.reserves.map((r: any) => {
                  const assetStr = r.asset || "";
                  if (assetStr === "native") return { code: "native", issuer: "" };
                  const parts = assetStr.split(':');
                  return { code: parts[0] || "", issuer: parts[1] || "" };
                });

                const matchesTokenA = assets.some((a: any) => 
                  a.code === tokenA.code && 
                  (tokenA.code === 'native' || a.issuer === tokenA.issuer)
                );
                const matchesTokenB = assets.some((a: any) => 
                  a.code === tokenB.code && 
                  (tokenB.code === 'native' || a.issuer === tokenB.issuer)
                );

                if (matchesTokenA && matchesTokenB) {
                  logger.info(`✅ Found existing pool in cache for ${tokenA.code}/${tokenB.code}: ${pool.id}`);
                  return { exists: true, pool, poolId: pool.id };
                }
              }
            }
          }
        } catch (dbError) {
          logger.warn(`Error reading from pool cache DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        }
      }

      // If not in cache, search through pools
      
      // Try to get pools for this pair (limit to first few to avoid long searches)
      const result = await this.getLiquidityPools(50, undefined, useCache);
      
      for (const pool of result.records) {
        if (this.isPoolEmpty(pool)) {
          continue;
        }

        const assets = pool.reserves.map((r: any) => {
          const assetStr = r.asset || "";
          if (assetStr === "native") return { code: "native", issuer: "" };
          const parts = assetStr.split(':');
          return { code: parts[0] || "", issuer: parts[1] || "" };
        });

        const matchesTokenA = assets.some((a: any) => 
          a.code === tokenA.code && 
          (tokenA.code === 'native' || a.issuer === tokenA.issuer)
        );
        const matchesTokenB = assets.some((a: any) => 
          a.code === tokenB.code && 
          (tokenB.code === 'native' || a.issuer === tokenB.issuer)
        );

        if (matchesTokenA && matchesTokenB) {
          logger.info(`✅ Found existing pool for ${tokenA.code}/${tokenB.code}: ${pool.id}`);
          
          // Cache this result
          if (useCache) {
            try {
              const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
              await PoolCache.findOneAndUpdate(
                { cacheKey: cacheKey1 },
                {
                  cacheKey: cacheKey1,
                  pools: [pool],
                  lastFetched: new Date(),
                  expiresAt,
                },
                { upsert: true, new: true }
              );
            } catch (dbError) {
              logger.warn(`Failed to cache pool existence check: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
            }
          }
          
          return { exists: true, pool, poolId: pool.id };
        }
      }

      return { exists: false };
    } catch (err: any) {
      logger.error(`❌ Error checking pool existence:`, err);
      // Return null on error to allow creation to proceed (fail open)
      return null;
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

      // Check if pool already exists
      const poolCheck = await this.checkPoolExists(tokenA, tokenB, true);
      if (poolCheck && poolCheck.exists && poolCheck.poolId) {
        const error = new Error(`Pool already exists for ${tokenA.code}/${tokenB.code}`);
        (error as any).poolExists = true;
        (error as any).poolId = poolCheck.poolId;
        (error as any).existingPool = poolCheck.pool;
        throw error;
      }

      // Validate user owns sufficient balance of both tokens
      try {
        const balances = await this.accountService.getBalances(publicKey, true);
        if (!balances || !balances.balances) {
          throw new Error('Failed to fetch account balances');
        }

        const amountANum = parseFloat(amountA);
        const amountBNum = parseFloat(amountB);

        const tokenABalance = balances.balances.find((b: any) => {
          if (tokenA.code === 'native') {
            return b.assetType === 'native';
          }
          return b.assetCode === tokenA.code && b.assetIssuer === tokenA.issuer;
        });

        const tokenBBalance = balances.balances.find((b: any) => {
          if (tokenB.code === 'native') {
            return b.assetType === 'native';
          }
          return b.assetCode === tokenB.code && b.assetIssuer === tokenB.issuer;
        });

        if (!tokenABalance || tokenABalance.amount < amountANum) {
          throw new Error(`Insufficient balance for ${tokenA.code}. Required: ${amountA}, Available: ${tokenABalance?.amount || 0}`);
        }

        if (!tokenBBalance || tokenBBalance.amount < amountBNum) {
          throw new Error(`Insufficient balance for ${tokenB.code}. Required: ${amountB}, Available: ${tokenBBalance?.amount || 0}`);
        }
      } catch (balanceError: any) {
        if (balanceError.message && balanceError.message.includes('Insufficient balance')) {
          throw balanceError;
        }
        logger.warn(`⚠️ Could not validate balances, proceeding anyway: ${balanceError.message}`);
      }

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

      const baseFee = await server.fetchBaseFee();

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
      
      // Submit trustline transaction using direct HTTP (workaround for SDK URL construction bug)
      let trustRes;
      try {
        const trustTxXdr = trustTx.toXDR();
        const submitUrl = `${env.HORIZON_URL}/transactions`;
        
        const response = await axios.post(submitUrl, `tx=${encodeURIComponent(trustTxXdr)}`, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        });
        
        trustRes = {
          hash: response.data.hash,
          ledger: response.data.ledger,
          envelope_xdr: response.data.envelope_xdr,
          result_xdr: response.data.result_xdr,
          result_meta_xdr: response.data.result_meta_xdr,
        };
        
        logger.success(`✅ Trustline established for pool share asset`);
      } catch (submitError: any) {
        logger.error(`❌ Trustline transaction submission failed`);
        if (submitError.response?.data) {
          const errorData = submitError.response.data;
          if (errorData.extras?.result_codes) {
            logger.error(`Result codes:`, errorData.extras.result_codes);
          }
          logger.error(`Error:`, submitError);
        } else {
          logger.error(`Error: ${submitError.message}`);
        }
        throw submitError;
      }

      const exactPrice = parseFloat(amountA) / parseFloat(amountB);
      const minPrice = (exactPrice * 0.9).toFixed(7);
      const maxPrice = (exactPrice * 1.1).toFixed(7);

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
      
      // Submit transaction using direct HTTP (workaround for SDK URL construction bug)
      let result;
      try {
        const txXdr = tx.toXDR();
        const submitUrl = `${env.HORIZON_URL}/transactions`;
        
        const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        });
        
        result = {
          hash: response.data.hash,
          ledger: response.data.ledger,
          envelope_xdr: response.data.envelope_xdr,
          result_xdr: response.data.result_xdr,
          result_meta_xdr: response.data.result_meta_xdr,
        };
        
        logger.success(`🚀 Liquidity pool created and liquidity added successfully!`);
      } catch (submitError: any) {
        logger.error(`❌ Transaction submission failed`);
        if (submitError.response?.data) {
          const errorData = submitError.response.data;
          if (errorData.extras?.result_codes) {
            logger.error(`Result codes:`, errorData.extras.result_codes);
          }
          logger.error(`Error:`, submitError);
        } else {
          logger.error(`Error: ${submitError.message}`);
        }
        throw submitError;
      }

      // Register pair in Pair model (if not already registered)
      try {
        const existingPair = await Pair.findOne({ poolId });
        if (!existingPair) {
          await Pair.create({
            baseToken: tokenA.code,
            quoteToken: tokenB.code,
            poolId,
            source: 'internal',
            verified: false,
          });
          logger.success(`✅ Pair registered: ${tokenA.code}/${tokenB.code}`);
        } else {
          logger.info(`ℹ️ Pair already registered for pool ${poolId}`);
        }
      } catch (pairError: any) {
        // Don't fail pool creation if pair registration fails
        logger.warn(`⚠️ Failed to register pair after pool creation: ${pairError?.message || String(pairError)}`);
      }

      // Clear relevant cache entries
      try {
        const tokenACode = tokenA.code === 'native' ? 'native' : tokenA.code.toUpperCase();
        const tokenBCode = tokenB.code === 'native' ? 'native' : tokenB.code.toUpperCase();
        const cacheKey1 = `pair:${tokenACode}:${tokenBCode}`;
        const cacheKey2 = `pair:${tokenBCode}:${tokenACode}`;
        
        await PoolCache.deleteMany({ 
          $or: [
            { cacheKey: 'all-pools' },
            { cacheKey: cacheKey1 },
            { cacheKey: cacheKey2 }
          ]
        });
        logger.info(`✅ Cleared pool cache for pair ${tokenA.code}/${tokenB.code}`);
      } catch (cacheError: any) {
        logger.warn(`⚠️ Failed to clear pool cache after pool creation: ${cacheError?.message || String(cacheError)}`);
      }

      return {
        poolId,
        liquidityTxHash: result.hash,
      };
    } catch (err: any) {
      logger.error('❌ Error creating liquidity pool:');
      logger.error(err);
      
      // Log detailed error information
      if (err?.response?.data) {
        logger.error('Error response data:', err.response.data);
        if (err.response.data.extras?.result_codes) {
          logger.error('Result codes:', err.response.data.extras.result_codes);
        }
      }
      
      // Preserve the original error structure but ensure it's an Error object
      const error = err instanceof Error ? err : new Error(err?.message || String(err));
      
      // Copy error properties including URL and method
      if (err?.response) {
        (error as any).response = err.response;
        (error as any).status = err.response?.status || err.status;
        (error as any).statusText = err.response?.statusText || err.statusText;
      }
      
      // Preserve URL and method from various possible locations
      (error as any).url = err.config?.url || 
                          err.request?.path || 
                          err.url || 
                          (err as any).requestUrl ||
                          (err as any).request?.url ||
                          (err.response?.config?.url) ||
                          'unknown';
      (error as any).method = err.config?.method || 
                             err.method || 
                             (err.response?.config?.method) ||
                             'unknown';
      
      // Copy response data and result codes
      if (err?.response?.data) {
        (error as any).type = err.response.data.type;
        (error as any).title = err.response.data.title;
        (error as any).detail = err.response.data.detail;
        
        if (err.response.data.extras?.result_codes) {
          (error as any).resultCodes = err.response.data.extras.result_codes;
          const operationError = err.response.data.extras.result_codes.operations?.[0];
          if (operationError) {
            (error as any).operationError = operationError;
            
            // Provide user-friendly error messages for common errors
            let userMessage = `Transaction failed: ${operationError}`;
            if (operationError === 'op_low_reserve') {
              userMessage = 'Insufficient balance: Account does not have enough Test Pi to cover the minimum reserve requirement. Each trustline and liquidity pool share requires a small reserve.';
            } else if (operationError === 'op_underfunded') {
              userMessage = 'Insufficient balance: Account does not have enough funds to complete this transaction.';
            } else if (operationError === 'op_line_full') {
              userMessage = 'Trustline limit reached: Cannot add more liquidity because the trustline limit has been reached.';
            }
            
            error.message = userMessage;
          }
        }
      }
      
      throw error;
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
        })
        .select('pools expiresAt')
        .lean();

        if (cached) {
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
      const serverUrl = (server as any).serverURL?.toString() || env.HORIZON_URL;
      
      // Validate limit is within acceptable range
      const validLimit = Math.min(Math.max(1, limit), 200);
      
      // Build query parameters
      const queryParams: string[] = [`limit=${validLimit}`];
      if (cursor && cursor.length > 0) {
        queryParams.push(`cursor=${encodeURIComponent(cursor)}`);
      }
      const apiPath = `/liquidity_pools?${queryParams.join('&')}`;
      
      let builder = server.liquidityPools().limit(validLimit);
      if (cursor && cursor.length > 0) {
        try {
          builder = builder.cursor(cursor);
        } catch (cursorError: any) {
          logger.error(`Invalid cursor format: ${cursorError?.message || String(cursorError)}`);
          throw new Error(`Invalid cursor format. Cursor must be a valid paging token.`);
        }
      }

      let pools;
      // Use direct HTTP request first to avoid SDK URL construction issues
      try {
        const response = await horizonQueue.get<any>(apiPath, {
          timeout: 10000,
          validateStatus: (status: number) => status < 500,
        }, 1);
        
        if (response && typeof response === 'object' && 'status' in response) {
          const httpResponse = response as { status: number; data?: any };
          if (httpResponse.status === 200 && httpResponse.data) {
            pools = {
              records: httpResponse.data._embedded?.records || [],
              paging_token: httpResponse.data._links?.next?.href ? 
                httpResponse.data._links.next.href.split('cursor=')[1]?.split('&')[0] : 
                undefined,
            };
          } else {
            throw new Error(`HTTP request returned status ${httpResponse.status}`);
          }
        } else {
          throw new Error('Invalid HTTP response format');
        }
      } catch (httpError: any) {
        // If direct HTTP fails, try SDK as fallback
        try {
          pools = await builder.call();
        } catch (sdkError: any) {
          logger.error(`Failed to fetch liquidity pools`);
          logger.error(`SDK Error:`, {
            message: sdkError?.message,
            status: sdkError?.response?.status,
            data: sdkError?.response?.data,
            url: sdkError?.config?.url || sdkError?.request?.path || (sdkError as any).requestUrl,
          });
          
          // If both fail, prefer HTTP error details but include SDK error info
          const combinedError = new Error(
            `Failed to fetch liquidity pools: ${httpError?.message || 'Unknown error'}`
          );
          (combinedError as any).httpError = httpError;
          (combinedError as any).sdkError = sdkError;
          throw combinedError;
        }
      }

      let nextCursor: string | undefined = undefined;
      try {
        if (pools.records.length === limit && pools.paging_token) {
          // Use paging_token as cursor for next page
          nextCursor = String(pools.paging_token);
        }
      } catch (e) {
        // Ignore paging token extraction errors
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
      }

      return {
        records: nonEmptyPools,
        nextCursor
      };
    } catch (err: any) {
      if (useCache && !cursor) {
        try {
          const cached = await PoolCache.findOne({ cacheKey: 'all-pools' })
          .select('pools')
          .lean();
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
      
      logger.error('Error fetching liquidity pools:', err);
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
        })
        .select('pools expiresAt')
        .lean();

        if (cached && cached.pools && cached.pools.length > 0) {
          const cachedPool = cached.pools[0];
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
        })
        .select('pools cacheKey')
        .lean();
        
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
        })
        .select('pools')
        .lean();
        
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
    
    // Use direct HTTP first (more reliable than SDK)
    try {
      const poolPath = `/liquidity_pools/${liquidityPoolId}`;
      const response = await horizonQueue.get<any>(poolPath, {
        timeout: 10000,
        validateStatus: (status: number) => status < 500,
      }, 1);
      
      if (response && typeof response === 'object' && 'status' in response) {
        const httpResponse = response as { status: number; data?: any };
        if (httpResponse.status === 200 && httpResponse.data) {
          const pool = httpResponse.data;
          
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
        }
      }
    } catch (httpError: any) {
      // HTTP failed, try SDK as fallback
    }
    
    // Fallback to SDK
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        
        const pool = await server.liquidityPools().liquidityPoolId(liquidityPoolId).call();
        
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
          logger.error(`❌ Error fetching liquidity pool by ID (${liquidityPoolId}):`, err);
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
      
      // Submit transaction using direct HTTP (workaround for SDK URL construction bug)
      const txXdr = tx.toXDR();
      const submitUrl = `${env.HORIZON_URL}/transactions`;
      
      const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      });
      
      const result = {
        hash: response.data.hash,
        ledger: response.data.ledger,
        envelope_xdr: response.data.envelope_xdr,
        result_xdr: response.data.result_xdr,
        result_meta_xdr: response.data.result_meta_xdr,
      };
      
      logger.success(`✅ Added liquidity successfully`);
      
      PoolCache.deleteMany({}).catch((err: any) => {
        logger.warn(`Failed to clear pool cache after adding liquidity: ${err?.message || String(err)}`);
      });
      
      return { hash: result.hash };
    } catch (err: any) {
      logger.error('❌ Error adding liquidity:', err);
      
      // Preserve the original error structure but ensure it's an Error object
      const error = err instanceof Error ? err : new Error(err?.message || String(err));
      
      // Copy error properties including URL and method
      if (err?.response) {
        (error as any).response = err.response;
        (error as any).status = err.response?.status || err.status;
        (error as any).statusText = err.response?.statusText || err.statusText;
      }
      
      // Preserve URL and method from various possible locations
      (error as any).url = err.config?.url || 
                          err.request?.path || 
                          err.url || 
                          (err as any).requestUrl ||
                          (err.response?.config?.url) ||
                          'unknown';
      (error as any).method = err.config?.method || 
                             err.method || 
                             (err.response?.config?.method) ||
                             'unknown';
      
      // Copy response data and result codes
      if (err?.response?.data) {
        (error as any).type = err.response.data.type;
        (error as any).title = err.response.data.title;
        (error as any).detail = err.response.data.detail;
        
        if (err.response.data.extras?.result_codes) {
          (error as any).resultCodes = err.response.data.extras.result_codes;
          const operationError = err.response.data.extras.result_codes.operations?.[0];
          if (operationError) {
            (error as any).operationError = operationError;
            
            // Provide user-friendly error messages for common errors
            let userMessage = `Transaction failed: ${operationError}`;
            if (operationError === 'op_low_reserve') {
              userMessage = 'Insufficient balance: Account does not have enough Test Pi to cover the minimum reserve requirement.';
            } else if (operationError === 'op_underfunded') {
              userMessage = 'Insufficient balance: Account does not have enough funds to complete this transaction.';
            } else if (operationError === 'op_line_full') {
              userMessage = 'Trustline limit reached: Cannot add more liquidity because the trustline limit has been reached.';
            }
            
            error.message = userMessage;
          }
        }
      }
      
      throw error;
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
      
      // Submit transaction using direct HTTP (workaround for SDK URL construction bug)
      const txXdr = tx.toXDR();
      const submitUrl = `${env.HORIZON_URL}/transactions`;
      
      const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      });
      
      const result = {
        hash: response.data.hash,
        ledger: response.data.ledger,
        envelope_xdr: response.data.envelope_xdr,
        result_xdr: response.data.result_xdr,
        result_meta_xdr: response.data.result_meta_xdr,
      };
      
      logger.success(`💧 Liquidity withdrawn successfully`);
      
      PoolCache.deleteMany({}).catch((err: any) => {
        logger.warn(`Failed to clear pool cache after removing liquidity: ${err?.message || String(err)}`);
      });
      
      return { hash: result.hash };
    } catch (err: any) {
      logger.error('❌ Error removing liquidity:', err);
      
      // Preserve the original error structure but ensure it's an Error object
      const error = err instanceof Error ? err : new Error(err?.message || String(err));
      
      // Copy error properties including URL and method
      if (err?.response) {
        (error as any).response = err.response;
        (error as any).status = err.response?.status || err.status;
        (error as any).statusText = err.response?.statusText || err.statusText;
      }
      
      // Preserve URL and method from various possible locations
      (error as any).url = err.config?.url || 
                          err.request?.path || 
                          err.url || 
                          (err as any).requestUrl ||
                          (err.response?.config?.url) ||
                          'unknown';
      (error as any).method = err.config?.method || 
                             err.method || 
                             (err.response?.config?.method) ||
                             'unknown';
      
      // Copy response data and result codes
      if (err?.response?.data) {
        (error as any).type = err.response.data.type;
        (error as any).title = err.response.data.title;
        (error as any).detail = err.response.data.detail;
        
        if (err.response.data.extras?.result_codes) {
          (error as any).resultCodes = err.response.data.extras.result_codes;
          const operationError = err.response.data.extras.result_codes.operations?.[0];
          if (operationError) {
            (error as any).operationError = operationError;
            
            // Provide user-friendly error messages for common errors
            let userMessage = `Transaction failed: ${operationError}`;
            if (operationError === 'op_low_reserve') {
              userMessage = 'Insufficient balance: Account does not have enough Test Pi to cover the minimum reserve requirement.';
            } else if (operationError === 'op_underfunded') {
              userMessage = 'Insufficient balance: Account does not have enough funds to complete this transaction.';
            } else if (operationError === 'op_line_full') {
              userMessage = 'Trustline limit reached: Cannot withdraw liquidity because the trustline limit has been reached.';
            }
            
            error.message = userMessage;
          }
        }
      }
      
      throw error;
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
      logger.error('❌ Error fetching pool rewards:', err);
      throw err;
    }
  }

  public async getUserLiquidityPools(userPublicKey: string) {
    try {
  
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
      logger.error(`❌ Error fetching user liquidity pools:`, err);
      throw err;
    }
  }

  public async getPlatformPools(useCache: boolean = true) {
    try {

      // Query Pair model for all registered pools
      const pairs = await Pair.find().sort({ createdAt: -1 }).lean();
      
      if (pairs.length === 0) {
        return [];
      }


      const platformPools = [];
      for (const pair of pairs) {
        try {
          // Try to get pool details from cache or Horizon
          const pool = await this.getLiquidityPoolById(pair.poolId, useCache);
          
          if (pool && !this.isPoolEmpty(pool)) {
            platformPools.push({
              poolId: pair.poolId,
              baseToken: pair.baseToken,
              quoteToken: pair.quoteToken,
              verified: pair.verified,
              source: pair.source,
              createdAt: pair.createdAt,
              pool: {
                id: pool.id,
                reserves: pool.reserves,
                total_shares: pool.total_shares,
                fee_bp: pool.fee_bp,
                last_modified_time: pool.last_modified_time,
              },
            });
          } else {
            logger.warn(`⚠️ Pool ${pair.poolId} is empty or not found, skipping`);
          }
        } catch (poolError: any) {
          logger.warn(`⚠️ Unable to fetch pool details for ${pair.poolId}: ${poolError?.message || String(poolError)}`);
          // Still include the pair info even if pool details can't be fetched
          platformPools.push({
            poolId: pair.poolId,
            baseToken: pair.baseToken,
            quoteToken: pair.quoteToken,
            verified: pair.verified,
            source: pair.source,
            createdAt: pair.createdAt,
            pool: null,
            error: 'Pool details unavailable',
          });
        }
      }

      logger.success(`✅ Found ${platformPools.length} platform pools with details`);
      return platformPools;
    } catch (err: any) {
      logger.error(`❌ Error fetching platform pools:`, err);
      throw err;
    }
  }
 
}
