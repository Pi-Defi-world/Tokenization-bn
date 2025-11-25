import * as StellarSdk from '@stellar/stellar-sdk';
import { server, getAsset } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';
import PoolCache from '../models/PoolCache';
import { Pair } from '../models/Pair';
import { AccountService } from './account.service';
import axios from 'axios';

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
      logger.info(`🔹 Checking if pool exists for pair: ${tokenA.code}/${tokenB.code}`);
      
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

      logger.info(`ℹ️ No existing pool found for ${tokenA.code}/${tokenB.code}`);
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
      // Verify we're using Pi Horizon API
      const serverUrl = (server as any).serverURL?.toString() || env.HORIZON_URL;
      logger.info(`🔹 Using Pi Horizon API: ${serverUrl}`);
      if (!serverUrl.includes('minepi.com')) {
        logger.error(`⚠️ WARNING: Server URL does not appear to be Pi Horizon! Using: ${serverUrl}`);
      }
      
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const publicKey = user.publicKey();

      logger.info(`🔹 Creating liquidity pool for user: ${publicKey}`);
      logger.info(`🔹 Token A: ${tokenA.code}, Token B: ${tokenB.code}`);

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
      
      // Copy error properties
      if (err?.response?.data) {
        (error as any).response = err.response;
        if (err.response.data.extras?.result_codes) {
          (error as any).resultCodes = err.response.data.extras.result_codes;
          const operationError = err.response.data.extras.result_codes.operations?.[0];
          if (operationError) {
            (error as any).operationError = operationError;
            error.message = `Transaction failed: ${operationError}`;
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
      // Log the server URL being used
      const serverUrl = (server as any).serverURL?.toString() || env.HORIZON_URL;
      logger.info(`🔹 Fetching liquidity pools from Pi Horizon: ${serverUrl}`);
      
      // Validate limit is within acceptable range
      const validLimit = Math.min(Math.max(1, limit), 200); // Between 1 and 200
      if (validLimit !== limit) {
        logger.warn(`⚠️ Limit ${limit} adjusted to ${validLimit} (must be between 1 and 200)`);
      }
      
      // Build query parameters manually to log them
      const queryParams: string[] = [`limit=${validLimit}`];
      if (cursor && cursor.length > 0) {
        const isHexHash = /^[0-9a-f]{64}$/i.test(cursor);
        if (!isHexHash) {
          queryParams.push(`cursor=${encodeURIComponent(cursor)}`);
        }
      }
      const expectedUrl = `${serverUrl}/liquidity_pools?${queryParams.join('&')}`;
      logger.info(`🔹 Expected request URL: ${expectedUrl}`);
      
      let builder = server.liquidityPools().limit(validLimit);
      
      if (cursor && cursor.length > 0) {
        const isHexHash = /^[0-9a-f]{64}$/i.test(cursor);
        if (isHexHash) {
          logger.warn(`⚠️ Cursor looks like a hex hash (pool ID?), skipping cursor. Use paging_token instead.`);
        } else {
          try {
            builder = builder.cursor(cursor);
            logger.info(`🔹 Using cursor for pagination: ${cursor.substring(0, 20)}...`);
          } catch (cursorError: any) {
            logger.error(`❌ Invalid cursor format: ${cursor}. Error: ${cursorError?.message || String(cursorError)}`);
            throw new Error(`Invalid cursor format. Cursor must be a valid paging token, not a pool ID or transaction hash.`);
          }
        }
      } else {
        logger.info(`🔹 Fetching first page of liquidity pools (limit: ${validLimit})`);
      }

      let pools;
      try {
        pools = await builder.call();
      } catch (sdkError: any) {
        // If SDK fails, try direct HTTP request as fallback
        logger.warn(`⚠️ SDK call failed, trying direct HTTP request...`);
        logger.error(`SDK Error:`, {
          message: sdkError?.message,
          status: sdkError?.response?.status,
          data: sdkError?.response?.data,
          url: sdkError?.config?.url || sdkError?.request?.path || (sdkError as any).requestUrl,
        });
        
        // Fallback to direct HTTP request
        try {
          const response = await axios.get(expectedUrl, {
            timeout: 10000,
            validateStatus: (status: number) => status < 500,
          });
          
          if (response.status === 200) {
            logger.info(`✅ Direct HTTP request succeeded, using response`);
            pools = {
              records: response.data._embedded?.records || [],
              paging_token: response.data._links?.next?.href ? response.data._links.next.href.split('cursor=')[1]?.split('&')[0] : undefined,
            };
          } else {
            throw sdkError; // Re-throw SDK error if HTTP also fails
          }
        } catch (httpError: any) {
          logger.error(`❌ Direct HTTP fallback also failed:`, httpError?.response?.data || httpError?.message);
          throw sdkError; // Re-throw original SDK error
        }
      }

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
          // Validate paging_token is not a pool ID (hex hash)
          const pagingToken = String(pools.paging_token);
          const isHexHash = /^[0-9a-f]{64}$/i.test(pagingToken);
          if (!isHexHash) {
            nextCursor = pagingToken;
          } else {
            logger.warn(`⚠️ paging_token looks like a pool ID (hex hash), not using it as cursor`);
            nextCursor = undefined;
          }
        }
      } catch (e) {
        logger.warn(`Error extracting paging_token: ${e instanceof Error ? e.message : String(e)}`);
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
      
      logger.error('❌ Error fetching liquidity pools:', err);
      
      // Log the server URL to verify we're using Pi Horizon
      const serverUrl = (server as any).serverURL?.toString() || env.HORIZON_URL;
      logger.error(`Server URL used: ${serverUrl}`);
      
      // Try to reconstruct the request URL that was made
      const queryParams: string[] = [`limit=${limit}`];
      if (cursor && cursor.length > 0) {
        const isHexHash = /^[0-9a-f]{64}$/i.test(cursor);
        if (!isHexHash) {
          queryParams.push(`cursor=${encodeURIComponent(cursor)}`);
        }
      }
      const reconstructedUrl = `${serverUrl}/liquidity_pools?${queryParams.join('&')}`;
      logger.error(`Reconstructed request URL: ${reconstructedUrl}`);
      
      // Log detailed error information for Bad Request errors
      if (err?.response?.status === 400 || err?.status === 400) {
        const errorDetails: any = {
          status: err.response?.status || err.status || 400,
          cursor: cursor,
          limit: limit,
          serverUrl: serverUrl,
          reconstructedUrl: reconstructedUrl,
        };
        
        // Try to extract URL and method from various possible locations
        errorDetails.url = err.config?.url || 
                         err.request?.path || 
                         err.url || 
                         (err as any).requestUrl || 
                         (err as any).request?.url ||
                         reconstructedUrl;
        errorDetails.method = err.config?.method || err.method || 'GET';
        
        // Extract full error response
        if (err.response?.data) {
          errorDetails.data = err.response.data;
          errorDetails.extras = err.response.data?.extras;
          errorDetails.invalid_field = err.response.data?.extras?.invalid_field;
          errorDetails.reason = err.response.data?.extras?.reason || 
                               err.response.data?.detail || 
                               err.response.data?.message || 
                               err.response.data?.title;
          errorDetails.type = err.response.data?.type;
        } else if (err.message) {
          errorDetails.message = err.message;
        }
        
        // Check if error has request information in different formats
        if ((err as any).request) {
          errorDetails.requestUrl = (err as any).request?.path || (err as any).request?.url;
        }
        
        // Try to get URL from SDK's internal state
        if ((err as any).requestUrl === undefined && (server as any).serverURL) {
          errorDetails.sdkServerUrl = (server as any).serverURL.toString();
        }
        
        logger.error('Bad Request details:', JSON.stringify(errorDetails, null, 2));
        
        // Verify we're using Pi Horizon, not Stellar
        if (!serverUrl.includes('minepi.com')) {
          logger.error(`⚠️ WARNING: Server URL does not appear to be Pi Horizon! Using: ${serverUrl}`);
        }
        
        // If it's a bad request with invalid parameters, provide a helpful error message
        if (errorDetails.invalid_field || errorDetails.reason) {
          const helpfulError = new Error(
            `Invalid request to Pi Horizon API: ${errorDetails.reason || errorDetails.invalid_field || 'Bad Request'}`
          );
          (helpfulError as any).status = 400;
          (helpfulError as any).details = errorDetails;
          throw helpfulError;
        }
      }
      
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
      const result = await server.submitTransaction(tx);
      logger.success(`✅ Added liquidity successfully`);
      
      PoolCache.deleteMany({}).catch((err: any) => {
        logger.warn(`Failed to clear pool cache after adding liquidity: ${err?.message || String(err)}`);
      });
      
      return { hash: result.hash };
    } catch (err: any) {
      logger.error('❌ Error adding liquidity:', err);
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
      logger.error('❌ Error removing liquidity:', err);
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
      logger.error('❌ Error fetching pool rewards:', err);
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
      logger.error(`❌ Error fetching user liquidity pools:`, err);
      throw err;
    }
  }

  public async getPlatformPools(useCache: boolean = true) {
    try {
      logger.info(`🔹 Fetching platform pools (pools created on this platform)`);

      // Query Pair model for all registered pools
      const pairs = await Pair.find().sort({ createdAt: -1 }).lean();
      
      if (pairs.length === 0) {
        logger.info(`ℹ️ No platform pools found`);
        return [];
      }

      logger.info(`🔹 Found ${pairs.length} registered pairs, fetching pool details...`);

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
