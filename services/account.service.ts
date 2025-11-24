import { server } from '../config/stellar';
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

// Cache configuration - longer TTL to reduce API calls and rate limiting
const CACHE_TTL_MS = 300000; // 5 minutes for successful fetches (reduced from 1 minute)
const CACHE_TTL_NOT_FOUND_MS = 600000; // 10 minutes for "not found" accounts (reduced from 5 minutes)
const CACHE_TTL_ERROR_MS = 30000; // 30 seconds for errors (increased from 10 seconds)

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

    // Check for valid (non-expired) cache first
    if (useCache && !forceRefresh && existingCachedBalances) {
      const isExpired = existingCachedBalances.expiresAt < new Date();
      const cacheAge = Date.now() - existingCachedBalances.lastFetched.getTime();
      const shouldRefreshStaleNotFound = existingCachedBalances.accountExists === false && cacheAge > 60000; // 1 minute
      
      if (!isExpired && !shouldRefreshStaleNotFound) {
        logger.info(`Using cached balances for account ${publicKey} (from DB, expires: ${existingCachedBalances.expiresAt.toISOString()}, exists: ${existingCachedBalances.accountExists})`);
        return { 
          publicKey, 
          balances: existingCachedBalances.balances,
          cached: true,
          accountExists: existingCachedBalances.accountExists 
        };
      }
    }

    // Fetch from Pi Horizon only (simplified - no fallbacks)
    try {
      logger.info(`Fetching balances from Pi Horizon for account ${publicKey}`);
      
      // Use Stellar SDK's loadAccount() - standard method
      const account = await server.loadAccount(publicKey);

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
        }
      }

      logger.info(`✅ Successfully fetched balances for account ${publicKey} (${balances.length} assets)`);
      return { publicKey, balances, cached: false, accountExists: true };
      
    } catch (error: any) {
      // Check if it's a "not found" error
      const isNotFoundError =
        error?.response?.status === 404 ||
        error?.constructor?.name === 'NotFoundError' ||
        (error?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found') ||
        (error?.response?.data?.status === 404) ||
        (error?.message && (
          error.message.toLowerCase().includes('account not found') ||
          error.message.toLowerCase().includes('not found: account') ||
          error.message === 'Not Found' ||
          error.message.toLowerCase().includes('404')
        ));

      if (isNotFoundError) {
        // Account doesn't exist - only cache if we don't have existing balances
        // If we have existing balances, it might be a temporary Horizon issue
        if (!existingCachedBalances || existingCachedBalances.balances.length === 0) {
          logger.info(`Account ${publicKey} not found on Pi network`);
          
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
          // We have existing balances - preserve them (might be temporary Horizon issue)
          logger.warn(`Account ${publicKey} returned 404 but we have cached balances. Preserving existing balances. Error: ${error?.message || 'Not Found'}`);
          return {
            publicKey,
            balances: existingCachedBalances.balances,
            cached: true,
            accountExists: existingCachedBalances.accountExists ?? true
          };
        }
      }

      // Other errors (network, timeout, etc.) - preserve existing balances if available
      logger.warn(`Failed to fetch balances for account ${publicKey} from Pi Horizon: ${error?.message || String(error)}`);
      
      if (existingCachedBalances && existingCachedBalances.balances.length > 0) {
        logger.info(`Preserving existing cached balances for account ${publicKey} due to fetch error`);
        return {
          publicKey,
          balances: existingCachedBalances.balances,
          cached: true,
          accountExists: existingCachedBalances.accountExists ?? true
        };
      }

      // No existing balances and fetch failed - return empty but don't cache as "not found"
      // This allows retry on next request
      logger.warn(`No cached balances available for account ${publicKey}, returning empty balances`);
      return { publicKey, balances: [], cached: false, accountExists: null };
    }
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
  // This method forces a refresh even if cached, useful for:
  // - User login (to get fresh balance)
  // - After transactions (to reflect changes)
  public async refreshBalancesInBackground(publicKey: string) {
    // Don't await - let it run in background
    // Force refresh to bypass cache and get fresh data
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


