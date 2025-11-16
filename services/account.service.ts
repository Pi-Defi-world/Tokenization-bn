import { server, getBalanceCheckServers } from '../config/stellar';
import { getKeypairFromMnemonic, getKeypairFromSecret } from '../utils/keypair';
import User from '../models/User';
import BalanceCache from '../models/BalanceCache';
import { logger } from '../utils/logger';
import * as StellarSdk from '@stellar/stellar-sdk';

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

// Cache configuration
const CACHE_TTL_MS = 60000; // 1 minute for successful fetches
const CACHE_TTL_NOT_FOUND_MS = 300000; // 5 minutes for "not found" accounts (to reduce API calls)
const CACHE_TTL_ERROR_MS = 10000; // 10 seconds for errors (retry sooner)

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

    // Check database cache first (unless forcing refresh)
    if (useCache && !forceRefresh) {
      try {
        const cached = await BalanceCache.findOne({ 
          publicKey,
          expiresAt: { $gt: new Date() } // Not expired
        });

        if (cached) {
          // If account was cached as "not found" but cache is older than 1 minute, allow refresh
          // This prevents stale "not found" caches from blocking legitimate account checks
          const cacheAge = Date.now() - cached.lastFetched.getTime();
          const shouldRefreshStaleNotFound = cached.accountExists === false && cacheAge > 60000; // 1 minute
          
          if (shouldRefreshStaleNotFound) {
            logger.info(`Cached "not found" is stale (${Math.round(cacheAge / 1000)}s old), refreshing...`);
            // Continue to fetch from network
          } else {
            logger.info(`Using cached balances for account ${publicKey} (from DB, expires: ${cached.expiresAt.toISOString()}, exists: ${cached.accountExists})`);
            return { 
              publicKey, 
              balances: cached.balances,
              cached: true,
              accountExists: cached.accountExists 
            };
          }
        }
      } catch (dbError) {
        logger.warn(`Error reading from balance cache DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        // Continue to fetch from network if DB read fails
      }
    }

    // Fetch from network with retry logic and dual Horizon endpoints
    const maxRetries = 2; // Reduced retries for scalability
    const horizonServers = getBalanceCheckServers();
    let lastError: any = null;
    let accountExists = true;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Try each Horizon server in order
      for (let serverIndex = 0; serverIndex < horizonServers.length; serverIndex++) {
        const currentServer = horizonServers[serverIndex];
        const serverName = serverIndex === 0 ? 'primary' : `fallback-${serverIndex}`;
        
        try {
          logger.info(`Attempting to fetch balances from ${serverName} Horizon server using Stellar SDK (attempt ${attempt}/${maxRetries})`);
          
          // Method 1: Use Stellar SDK's loadAccount() - standard SDK method
          // This is the primary and recommended way to fetch account balances
          let account;
          let loadAccountError: any = null;
          try {
            account = await currentServer.loadAccount(publicKey);
          } catch (err: any) {
            loadAccountError = err;
            // Method 2: Alternative SDK method - accounts().accountId() as fallback
            // This uses the accounts endpoint directly via SDK
            logger.warn(`loadAccount() failed (${err?.response?.status || err?.constructor?.name || 'unknown error'}), trying alternative SDK method accounts().accountId()...`);
            try {
              const accountResponse = await currentServer.accounts().accountId(publicKey).call();
              // Convert the response to match loadAccount format
              account = {
                accountId: accountResponse.account_id,
                balances: accountResponse.balances || [],
                sequenceNumber: accountResponse.sequence_number,
                subentryCount: accountResponse.subentry_count,
                thresholds: accountResponse.thresholds,
                flags: accountResponse.flags,
                signers: accountResponse.signers || [],
                data: accountResponse.data || {},
                homeDomain: accountResponse.home_domain,
              };
              logger.info(`✅ Successfully fetched using alternative SDK method accounts().accountId()`);
            } catch (accountsError: any) {
              // Log both errors for debugging
              logger.warn(`Alternative SDK method also failed: ${accountsError?.response?.status || accountsError?.constructor?.name || 'unknown error'}`);
              
              // If both methods failed with 404, it's definitely "not found"
              const isLoadAccount404 = loadAccountError?.response?.status === 404 || 
                                       loadAccountError?.constructor?.name === 'NotFoundError';
              const isAccounts404 = accountsError?.response?.status === 404 || 
                                   accountsError?.constructor?.name === 'NotFoundError';
              
              if (isLoadAccount404 && isAccounts404) {
                // Both methods confirm 404 - definitely not found
                throw loadAccountError;
              }
              
              // If one is 404 and the other isn't, or both are different errors, throw the more specific one
              // Prefer the accounts error if it's more specific, otherwise use loadAccount error
              if (isAccounts404) {
                throw accountsError;
              }
              throw loadAccountError;
            }
          }
          
          accountExists = true;
          
          // If we used a fallback server, log it
          if (serverIndex > 0) {
            logger.info(`✅ Successfully fetched from ${serverName} Horizon server`);
          }

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
              assetCode: b.asset_code || 'XLM',
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

        // Save to database cache
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
            // Continue even if DB save fails
          }
        }

          logger.info(`✅ Successfully fetched balances for account ${publicKey} (${balances.length} assets)`);
          return { publicKey, balances, cached: false, accountExists: true };
        } catch (error: any) {
          // If this is not the last server, try the next one
          if (serverIndex < horizonServers.length - 1) {
            logger.warn(`Failed to fetch from ${serverName} Horizon server, trying next server...`);
            lastError = error;
            continue; // Try next server
          }
          
          // This was the last server, save error and break
          lastError = error;
          break; // Break out of server loop, will retry in next attempt
        }
      }
      
      // If we get here, all servers failed for this attempt
      // Check if it's a "not found" error
      const isNotFoundError =
        lastError?.response?.status === 404 ||
        lastError?.constructor?.name === 'NotFoundError' ||
        (lastError?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found') ||
        (lastError?.response?.data?.status === 404) ||
        (lastError?.message && (
          lastError.message.toLowerCase().includes('account not found') ||
          lastError.message.toLowerCase().includes('not found: account') ||
          lastError.message === 'Not Found' ||
          lastError.message.toLowerCase().includes('404')
        ));
      
      // Log detailed error info for debugging
      if (attempt === 1) {
        const errorDetails = {
          status: lastError?.response?.status,
          errorType: lastError?.constructor?.name,
          message: lastError?.message,
          dataType: lastError?.response?.data?.type,
          isNotFound: isNotFoundError,
        };
        logger.warn(`Error details for ${publicKey}: ${JSON.stringify(errorDetails)}`);
      }

      // If account not found, don't retry - cache and return empty balances
      if (isNotFoundError) {
        accountExists = false;
        logger.info(`Account ${publicKey} not found on Pi network (attempt ${attempt})`);

        // Cache "not found" status with longer TTL to reduce API calls
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
      }

      // Log error only on first attempt
      if (attempt === 1) {
        const errorDetails = {
          message: lastError?.message || String(lastError),
          status: lastError?.response?.status,
          errorType: lastError?.constructor?.name,
          attempt,
        };
        logger.error(`Error fetching balances for account ${publicKey} from all Horizon servers (attempt ${attempt}/${maxRetries}):`, errorDetails);
      }

      // For other errors, retry with exponential backoff (only once)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * attempt, 3000); // Max 3 seconds
        logger.warn(`Retrying balance fetch for ${publicKey} in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }

    // All retries failed - cache error with short TTL
    if (useCache) {
      try {
        const expiresAt = new Date(Date.now() + CACHE_TTL_ERROR_MS);
        await BalanceCache.findOneAndUpdate(
          { publicKey },
          {
            publicKey,
            balances: [],
            accountExists: false, // Assume doesn't exist on error
            lastFetched: new Date(),
            expiresAt,
          },
          { upsert: true, new: true }
        );
      } catch (dbError) {
        logger.warn(`Failed to save error cache to DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }

    logger.error(`❌ Failed to fetch balances for account ${publicKey} after ${maxRetries} attempts:`, lastError);
    throw lastError;
  }

  public async getOperations(params: OperationsQuery) {
    const { publicKey, limit = 20, cursor, order = 'desc' } = params;
    if (!publicKey) throw new Error('publicKey is required');

    let builder = server.operations().forAccount(publicKey).limit(limit).order(order);
    if (cursor) builder = builder.cursor(cursor);

    const ops = await builder.call();

    const records = ops.records.map((op: any) => {
      const base = {
        id: op.id,
        createdAt: op.created_at,
        type: op.type,
        source: op.source_account,
        transactionHash: op.transaction_hash,
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

    const nextCursor = records.length
      ? records[records.length - 1].paging_token
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

  // Clear cache for a specific account (useful after transactions)
  public async clearBalanceCache(publicKey: string) {
    try {
      await BalanceCache.deleteOne({ publicKey });
      logger.info(`Cleared balance cache for account ${publicKey}`);
    } catch (error) {
      logger.error(`Failed to clear balance cache for ${publicKey}:`, error);
    }
  }

  // Clear all cached balances (use with caution)
  public async clearAllBalanceCache() {
    try {
      const result = await BalanceCache.deleteMany({});
      logger.info(`Cleared ${result.deletedCount} balance cache entries`);
    } catch (error) {
      logger.error('Failed to clear all balance cache:', error);
    }
  }

  // Background refresh for a specific account (non-blocking)
  public async refreshBalancesInBackground(publicKey: string) {
    // Check cache first - don't refresh if account is known to not exist
    try {
      const cached = await BalanceCache.findOne({ 
        publicKey,
        expiresAt: { $gt: new Date() }
      });
      
      // If account is cached as not existing, skip background refresh
      if (cached && cached.accountExists === false) {
        logger.info(`Skipping background refresh for ${publicKey} - account cached as not existing`);
        return;
      }
    } catch (dbError) {
      // If cache check fails, proceed with refresh anyway
      logger.warn(`Failed to check cache before background refresh: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    }
    
    // Don't await - let it run in background
    this.getBalances(publicKey, true, true).catch((error) => {
      logger.warn(`Background balance refresh failed for ${publicKey}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  // Batch refresh multiple accounts (for background jobs)
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


