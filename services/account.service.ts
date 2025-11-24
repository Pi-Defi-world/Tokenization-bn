import { server, getBalanceCheckServers } from '../config/stellar';
import { getKeypairFromMnemonic, getKeypairFromSecret } from '../utils/keypair';
import User from '../models/User';
import BalanceCache from '../models/BalanceCache';
import { logger } from '../utils/logger';
import * as StellarSdk from '@stellar/stellar-sdk';
import env from '../config/env';
import axios from 'axios';

export interface ImportAccountInput {
  mnemonic?: string;
  secret?: string;
  userId?: string;
}

export interface TransactionsQuery {
  publicKey: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}

export interface OperationsQuery {
  publicKey: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}

// Cache configuration - longer TTL to reduce API calls and rate limiting
const CACHE_TTL_MS = 300000; // 5 minutes for successful fetches
const CACHE_TTL_NOT_FOUND_MS = 30000; // 30 seconds for "not found" accounts (very short to allow retry)
const CACHE_TTL_ERROR_MS = 30000; // 30 seconds for errors

export class AccountService {
  public async importAccount(input: ImportAccountInput) {
    const { mnemonic, secret, userId } = input;
    if (!mnemonic && !secret) {
      throw new Error('Provide mnemonic or secret');
    }

    let publicKey: string;
    let secretKey: string;

    if (mnemonic) {
      const kp = await getKeypairFromMnemonic(mnemonic);
      publicKey = kp.publicKey();
      secretKey = kp.secret();
    } else {
      const kp = getKeypairFromSecret(secret as string);
      publicKey = kp.publicKey();
      secretKey = kp.secret();
    }

    // If userId is provided, validate public key matches existing user's public_key
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        if (user.public_key && user.public_key.trim() !== '') {
          if (user.public_key !== publicKey) {
            throw new Error('Invalid credentials. Please check your mnemonic/secret.');
          }
          logger.info(`Public key validated for user ${userId}`);
        } else {
          // User exists but doesn't have public_key, store it
          user.public_key = publicKey;
          await user.save();
          logger.info(`Public key stored for user ${userId}`);
        }
      } else {
        throw new Error('User not found');
      }
    }

    return { publicKey, secret: secretKey };
  }

  public async getBalances(publicKey: string, useCache: boolean = true, forceRefresh: boolean = false) {
    if (!publicKey) {
      throw new Error('publicKey is required');
    }

    // Get existing cached balances (even if expired) to preserve on failure
    let existingCachedBalances: any = null;
    if (useCache) {
      try {
        existingCachedBalances = await BalanceCache.findOne({ publicKey });
      } catch (dbError) {
        logger.warn(`Error reading from balance cache DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }
    if (useCache && !forceRefresh && existingCachedBalances) {
      const isExpired = existingCachedBalances.expiresAt < new Date();
      const isNotFoundCache = existingCachedBalances.accountExists === false;

      const cacheAge = Date.now() - existingCachedBalances.lastFetched.getTime();
      const shouldRetryNotFound = isNotFoundCache && cacheAge > 10000; // Retry after 10 seconds
      
      if (!isExpired && !isNotFoundCache && !shouldRetryNotFound) {
        logger.info(`Using cached balances for account ${publicKey} (from DB, expires: ${existingCachedBalances.expiresAt.toISOString()}, exists: ${existingCachedBalances.accountExists})`);
        return { 
          publicKey, 
          balances: existingCachedBalances.balances,
          cached: true,
          accountExists: existingCachedBalances.accountExists 
        };
      }
      
      // If it's a "not found" cache that's older than 10 seconds, log and retry
      if (isNotFoundCache && shouldRetryNotFound) {
        logger.info(`Retrying fetch for account ${publicKey} - previous "not found" cache is ${Math.round(cacheAge / 1000)}s old (account may exist now)`);
      }
    }
    let directHttpTest: { exists: boolean; accountData?: any; error?: any } | null = null;
    try {
      const horizonUrl = env.HORIZON_URL;
      const testUrl = `${horizonUrl}/accounts/${publicKey}`;
      logger.info(`🔍 Testing account existence via direct HTTP: ${testUrl}`);
      
      const response = await axios.get(testUrl, { 
        timeout: 10000,
        validateStatus: (status) => status < 500  
      });
      
      if (response.status === 200) {
        directHttpTest = { exists: true, accountData: response.data };
        logger.info(`✅ Direct HTTP test confirms account ${publicKey} EXISTS on Pi Network Horizon`);
      } else if (response.status === 404) {
        directHttpTest = { exists: false };
        logger.warn(`⚠️ Direct HTTP test confirms account ${publicKey} does NOT exist (404)`);
      } else {
        logger.warn(`⚠️ Direct HTTP test returned unexpected status: ${response.status}`);
      }
    } catch (httpError: any) {
      logger.warn(`Direct HTTP test failed (this is OK, will try SDK): ${httpError?.message || String(httpError)}`);
      directHttpTest = { exists: false, error: httpError };
    }
    
    const servers = getBalanceCheckServers();
    let lastError: any = null;
    let account: any = null;
    const MAX_RETRIES_PER_SERVER = 2;  
    
    for (let i = 0; i < servers.length; i++) {
      const currentServer = servers[i];
      const serverName = i === 0 ? 'Pi Horizon' : 'Pi Horizon (fallback)';
      
      let retryCount = 0;
      let serverSuccess = false;
      
      while (retryCount < MAX_RETRIES_PER_SERVER && !serverSuccess) {
        try {
          if (retryCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            logger.info(`Retrying ${serverName} for account ${publicKey} (retry ${retryCount}/${MAX_RETRIES_PER_SERVER - 1})`);
          } else {
            logger.info(`Fetching balances from ${serverName} for account ${publicKey} (attempt ${i + 1}/${servers.length})`);
            try {
              const horizonUrl = env.HORIZON_URL;
              logger.info(`Using Horizon URL: ${horizonUrl}/accounts/${publicKey}`);
            } catch (e) {
            }
          }
          
          // Use Stellar SDK's loadAccount() - standard method
          account = await currentServer.loadAccount(publicKey);
          
          serverSuccess = true;
          if (i > 0 || retryCount > 0) {
            logger.info(`✅ Account found on ${serverName}${retryCount > 0 ? ' (after retry)' : ' (fallback server)'}`);
          }
          break;
        } catch (error: any) {
          lastError = error;
          
          // Log detailed error information for debugging
          logger.error(`❌ Error fetching account ${publicKey} from ${serverName}:`, {
            message: error?.message || String(error),
            code: error?.code,
            status: error?.response?.status,
            statusText: error?.response?.statusText,
            errorType: error?.constructor?.name,
            responseData: error?.response?.data,
            responseHeaders: error?.response?.headers,
            url: error?.config?.url || error?.request?.path,
          });
          
          const isNetworkError =
            error?.code === 'ECONNREFUSED' ||
            error?.code === 'ETIMEDOUT' ||
            error?.code === 'ENOTFOUND' ||
            error?.code === 'ECONNRESET' ||
            error?.message?.toLowerCase().includes('timeout') ||
            error?.message?.toLowerCase().includes('network') ||
            error?.message?.toLowerCase().includes('connection') ||
            (error?.response?.status >= 500 && error?.response?.status < 600); // 5xx server errors
          
          const isNotFoundError =
            !isNetworkError && (
              error?.response?.status === 404 ||
              error?.constructor?.name === 'NotFoundError' ||
              (error?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found') ||
              (error?.response?.data?.status === 404) ||
              (error?.message && (
                error.message.toLowerCase().includes('not found') ||
                error.message.toLowerCase().includes('404')
              ))
            );
          if (isNetworkError) {
            retryCount++;
            if (retryCount < MAX_RETRIES_PER_SERVER) {
              logger.info(`Network error from ${serverName}, will retry (${retryCount}/${MAX_RETRIES_PER_SERVER})...`);
              continue;
            } else {
              if (i < servers.length - 1) {
                logger.warn(`Network error on ${serverName} after ${MAX_RETRIES_PER_SERVER} attempts, trying next Pi Network server...`);
                break;
              } else {
                logger.error(`Network error on all Pi Network servers for account ${publicKey} - this is likely a connectivity issue`);
                break;
              }
            }
          } else if (isNotFoundError) {
            retryCount++;
            if (retryCount < MAX_RETRIES_PER_SERVER) {
              continue;
            } else {
              if (i < servers.length - 1) {
                logger.warn(`Account not found on ${serverName} after ${MAX_RETRIES_PER_SERVER} attempts, trying next Pi Network server...`);
                break;
              } else {
                logger.info(`Account ${publicKey} not found on any Pi Network Horizon server after all retries`);
                break;
              }
            }
          } else {  
            logger.warn(`Error fetching from ${serverName}: ${error?.message || String(error)} (status: ${error?.response?.status || 'unknown'})`);
            if (i < servers.length - 1) {
              break;
            } else {
              break;
            }
          }
        }
      }
      
      if (serverSuccess) {
        break;
      }
    }
    
    if (account) {

      const THRESHOLD = 0.1;

      const balances = (account.balances || [])
        .map((b: any) => {
          const amountNum =
            typeof b.balance === 'string' ? parseFloat(b.balance) : Number(b.balance || 0);

          let assetLabel: string;
          if (b.asset_type === 'native') {
            assetLabel = 'Test Pi';
          } else if (b.asset_type === 'liquidity_pool_shares') {
            assetLabel = `liquidity_pool:${b.liquidity_pool_id || 'unknown'}`;
          } else {
            assetLabel = `${b.asset_code}:${b.asset_issuer}`;
          }

          return {
            assetType: b.asset_type,
            assetCode: b.asset_code || 'Test Pi',
            assetIssuer: b.asset_issuer || null,
            asset: assetLabel,
            amount: amountNum,
            raw: b.balance,
          };
        })
        .filter((entry: any) => {
          if (Number.isNaN(entry.amount)) return false;
          return entry.amount > THRESHOLD;
        });

      if (useCache) {
        try {
          const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
          await BalanceCache.findOneAndUpdate(
            { publicKey },
            {
              publicKey,
              balances,
              accountExists: true,
              lastFetched: new Date(),
              expiresAt,
            },
            { upsert: true, new: true }
          );
        } catch (dbError) {
          logger.warn(`Failed to save balance cache to DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        }
      }

      logger.info(`✅ Successfully fetched balances for account ${publicKey} (${balances.length} assets)`);
      return { publicKey, balances, cached: false, accountExists: true };
    }
    
    if (lastError) {
      const isNetworkError =
        lastError?.code === 'ECONNREFUSED' ||
        lastError?.code === 'ETIMEDOUT' ||
        lastError?.code === 'ENOTFOUND' ||
        lastError?.code === 'ECONNRESET' ||
        lastError?.message?.toLowerCase().includes('timeout') ||
        lastError?.message?.toLowerCase().includes('network') ||
        lastError?.message?.toLowerCase().includes('connection') ||
        (lastError?.response?.status >= 500 && lastError?.response?.status < 600);
      
      const isNotFoundError =
        !isNetworkError && (
          lastError?.response?.status === 404 ||
          lastError?.constructor?.name === 'NotFoundError' ||
          (lastError?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found') ||
          (lastError?.response?.data?.status === 404) ||
          (lastError?.message && (
            lastError.message.toLowerCase().includes('account not found') ||
            lastError.message.toLowerCase().includes('not found: account') ||
            lastError.message === 'Not Found' ||
            lastError.message.toLowerCase().includes('404')
          ))
        );

      if (isNetworkError) {
        logger.error(`Network/connection error fetching balances for account ${publicKey} from Pi Network Horizon: ${lastError?.message || String(lastError)} (code: ${lastError?.code || 'unknown'})`);
        
        if (existingCachedBalances && existingCachedBalances.balances.length > 0) {
          logger.info(`Preserving existing cached balances for account ${publicKey} due to network error`);
          return {
            publicKey,
            balances: existingCachedBalances.balances,
            cached: true,
            accountExists: existingCachedBalances.accountExists ?? true
          };
        }
        
        logger.warn(`No cached balances available for account ${publicKey}, returning empty due to network error`);
        return { publicKey, balances: [], cached: false, accountExists: null };
        } else if (isNotFoundError) {
          // If direct HTTP test confirmed account exists, this is likely a SDK issue
          // Use the HTTP response data as fallback
          if (directHttpTest?.exists === true && directHttpTest?.accountData) {
            logger.error(`🚨 CRITICAL: Direct HTTP test confirms account EXISTS, but SDK returned 404! This indicates a SDK/connection issue, not account not found.`);
            logger.info(`Using HTTP response data as fallback since SDK failed but account exists`);
            
            try {
              // Parse account data from HTTP response (same format as SDK would return)
              const httpAccountData = directHttpTest.accountData;
              
              const THRESHOLD = 0.1;
              const balances = (httpAccountData.balances || [])
                .map((b: any) => {
                  const amountNum =
                    typeof b.balance === 'string' ? parseFloat(b.balance) : Number(b.balance || 0);

                  let assetLabel: string;
                  if (b.asset_type === 'native') {
                    assetLabel = 'Test Pi';
                  } else if (b.asset_type === 'liquidity_pool_shares') {
                    assetLabel = `liquidity_pool:${b.liquidity_pool_id || 'unknown'}`;
                  } else {
                    assetLabel = `${b.asset_code}:${b.asset_issuer}`;
                  }

                  return {
                    assetType: b.asset_type,
                    assetCode: b.asset_code || 'Test Pi',
                    assetIssuer: b.asset_issuer || null,
                    asset: assetLabel,
                    amount: amountNum,
                    raw: b.balance,
                  };
                })
                .filter((entry: any) => {
                  if (Number.isNaN(entry.amount)) return false;
                  return entry.amount > THRESHOLD;
                });

              // Cache the balances from HTTP response
              if (useCache) {
                try {
                  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
                  await BalanceCache.findOneAndUpdate(
                    { publicKey },
                    {
                      publicKey,
                      balances,
                      accountExists: true,
                      lastFetched: new Date(),
                      expiresAt,
                    },
                    { upsert: true, new: true }
                  );
                } catch (dbError) {
                  logger.warn(`Failed to save balance cache to DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
                }
              }

              logger.info(`✅ Successfully parsed balances from HTTP response for account ${publicKey} (${balances.length} assets) - SDK workaround`);
              return { publicKey, balances, cached: false, accountExists: true };
            } catch (parseError: any) {
              logger.error(`Failed to parse account data from HTTP response: ${parseError?.message || String(parseError)}`);
              
              // Fall back to cached balances if available
              if (existingCachedBalances && existingCachedBalances.balances.length > 0) {
                logger.warn(`Preserving existing cached balances - account exists but SDK and HTTP parsing failed`);
                return {
                  publicKey,
                  balances: existingCachedBalances.balances,
                  cached: true,
                  accountExists: true
                };
              }
              
              // Return empty but don't mark as "not found"
              return { publicKey, balances: [], cached: false, accountExists: null };
            }
          }
          
          if (!existingCachedBalances || existingCachedBalances.balances.length === 0) {
            logger.info(`Account ${publicKey} not found on any Pi Network Horizon server (tried ${servers.length} servers)`);
            
            if (useCache) {
              try {
                const expiresAt = new Date(Date.now() + CACHE_TTL_NOT_FOUND_MS);
                await BalanceCache.findOneAndUpdate(
                  { publicKey },
                  {
                    publicKey,
                    balances: [],
                    accountExists: false,
                    lastFetched: new Date(),
                    expiresAt,
                  },
                  { upsert: true, new: true }
                );
              } catch (dbError) {
                logger.warn(`Failed to save "not found" cache to DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
              }
            }
            
            return { publicKey, balances: [], cached: false, accountExists: false };
        } else {
          logger.warn(`Account ${publicKey} returned 404 but we have cached balances. Preserving existing balances. Error: ${lastError?.message || 'Not Found'}`);
          return {
            publicKey,
            balances: existingCachedBalances.balances,
            cached: true,
            accountExists: existingCachedBalances.accountExists ?? true
          };
        }
      }

      logger.warn(`Failed to fetch balances for account ${publicKey} from all Pi Network Horizon servers: ${lastError?.message || String(lastError)} (status: ${lastError?.response?.status || 'unknown'})`);
      
      if (existingCachedBalances && existingCachedBalances.balances.length > 0) {
        logger.info(`Preserving existing cached balances for account ${publicKey} due to fetch error`);
        return {
          publicKey,
          balances: existingCachedBalances.balances,
          cached: true,
          accountExists: existingCachedBalances.accountExists ?? true
        };
      }

      logger.warn(`No cached balances available for account ${publicKey}, returning empty balances`);
      return { publicKey, balances: [], cached: false, accountExists: null };
    }
  }

  public async getOperations(params: OperationsQuery) {
    const { publicKey, limit = 20, cursor, order = 'desc' } = params;
    if (!publicKey) throw new Error('publicKey is required');

    try {
      let builder = server.operations().forAccount(publicKey).limit(limit).order(order);
      if (cursor) builder = builder.cursor(cursor);

      const ops = await builder.call();
      return this.formatOperations(ops.records, publicKey, limit, order);
    } catch (error: any) {
      // If SDK fails with 404, try HTTP fallback
      const isNotFoundError =
        error?.response?.status === 404 ||
        error?.constructor?.name === 'NotFoundError' ||
        (error?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found') ||
        (error?.response?.data?.status === 404) ||
        (error?.message && (
          error.message.toLowerCase().includes('not found') ||
          error.message.toLowerCase().includes('404')
        ));

      if (isNotFoundError) {
        logger.warn(`SDK failed to fetch operations for ${publicKey}, trying HTTP fallback...`);
        try {
          const horizonUrl = env.HORIZON_URL;
          let operationsUrl = `${horizonUrl}/accounts/${publicKey}/operations?limit=${limit}&order=${order}`;
          if (cursor) {
            operationsUrl += `&cursor=${cursor}`;
          }

          const response = await axios.get(operationsUrl, { timeout: 10000 });
          if (response.status === 200 && response.data._embedded && response.data._embedded.records) {
            logger.info(`✅ Successfully fetched operations via HTTP fallback for account ${publicKey}`);
            return this.formatOperations(response.data._embedded.records, publicKey, limit, order);
          }
        } catch (httpError: any) {
          logger.error(`HTTP fallback also failed for operations: ${httpError?.message || String(httpError)}`);
        }
      }
 
      logger.error(`❌ getAccountOperations failed: ${error.message}`);
      throw error;
    }
  }

  private formatOperations(ops: any[], publicKey: string, limit: number, order: 'asc' | 'desc') {
    const records = ops.map((op: any) => {
      const base = {
        id: op.id,
        createdAt: op.created_at,
        type: op.type,
        source: op.source_account,
        transactionHash: op.transaction_hash,
        paging_token: op.paging_token || null,
      };

      switch (op.type) {
        case 'payment':
          return {
            ...base,
            action: op.from === publicKey ? 'sent' : 'received',
            from: op.from,
            to: op.to,
            amount: op.amount,
            asset:
              op.asset_type === 'native'
                ? 'Pi'
                : `${op.asset_code}:${op.asset_issuer}`,
          };

        case 'create_account':
          return {
            ...base,
            action: op.funder === publicKey ? 'created account' : 'account created for me',
            funder: op.funder,
            account: op.account,
            startingBalance: op.starting_balance,
          };

        case 'change_trust':
          return {
            ...base,
            action: op.limit === '0' ? 'removed trustline' : 'added trustline',
            asset: `${op.asset_code}:${op.asset_issuer}`,
            limit: op.limit,
          };

        case 'manage_sell_offer':
        case 'manage_buy_offer':
        case 'create_passive_sell_offer':
          return {
            ...base,
            action: 'managed offer',
            selling:
              op.selling_asset_type === 'native'
                ? 'Pi'
                : `${op.selling_asset_code}:${op.selling_asset_issuer}`,
            buying:
              op.buying_asset_type === 'native'
                ? 'Pi'
                : `${op.buying_asset_code}:${op.buying_asset_issuer}`,
            amount: op.amount,
            price: op.price,
          };

        case 'set_options':
          return {
            ...base,
            action: 'updated account options',
            signer: op.signer_key || null,
            masterWeight: op.master_weight || null,
            lowThreshold: op.low_threshold || null,
            medThreshold: op.med_threshold || null,
            highThreshold: op.high_threshold || null,
          };

        case 'account_merge':
          return {
            ...base,
            action:
              op.into === publicKey
                ? 'received merged account'
                : 'merged into another account',
            destination: op.into,
          };

        default:
          return { ...base, action: `unknown (${op.type})`, details: op };
      }
    });

    const nextCursor = records.length && (records[records.length - 1] as any).paging_token
      ? (records[records.length - 1] as any).paging_token
      : null;

    return {
      data: records,
      pagination: {
        limit,
        nextCursor,
        hasMore: Boolean(nextCursor),
        order,
      },
    };
  }

  public async clearBalanceCache(publicKey: string) {
    try {
      await BalanceCache.deleteOne({ publicKey });
      logger.info(`Cleared balance cache for account ${publicKey}`);
    } catch (error) {
      logger.error(`Failed to clear balance cache for ${publicKey}:`, error);
    }
  }

  public async clearAllBalanceCache() {
    try {
      const result = await BalanceCache.deleteMany({});
      logger.info(`Cleared ${result.deletedCount} balance cache entries`);
    } catch (error) {
      logger.error('Failed to clear all balance cache:', error);
    }
  }
 
  public async refreshBalancesInBackground(publicKey: string) {
    this.getBalances(publicKey, true, true).catch((error) => {
      logger.warn(`Background balance refresh failed for ${publicKey}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  public async refreshBalancesBatch(publicKeys: string[], concurrency: number = 5) {
    const results = [];
    for (let i = 0; i < publicKeys.length; i += concurrency) {
      const batch = publicKeys.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(pk => this.getBalances(pk, true, true))
      );
      results.push(...batchResults);
    }
    return results;
  }
}


