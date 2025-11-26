import { server } from '../config/stellar';
import { logger } from '../utils/logger';
import env from '../config/env';
import { horizonQueue } from '../utils/horizon-queue';
import TransactionCache from '../models/TransactionCache';
import * as StellarSdk from '@stellar/stellar-sdk';

export interface TransactionsQuery {
  publicKey: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}

const CACHE_TTL_MS = 300000; // 5 minutes for successful fetches
const CACHE_TTL_ERROR_MS = 30000; // 30 seconds for errors

export class TransactionHistoryService {
  /**
   * Get account transactions with caching
   */
  public async getTransactions(
    publicKey: string,
    limit: number = 20,
    cursor?: string,
    order: 'asc' | 'desc' = 'desc',
    useCache: boolean = true,
    forceRefresh: boolean = false
  ) {
    if (!publicKey) {
      throw new Error('publicKey is required');
    }

    const cacheKey = cursor || '';
    const cacheLookupKey = `${publicKey}:${cacheKey}:${limit}:${order}`;

    // Check cache first
    let cachedTransactions: any = null;
    if (useCache && !forceRefresh) {
      try {
        cachedTransactions = await TransactionCache.findOne({ 
          publicKey,
          cursor: cacheKey,
          expiresAt: { $gt: new Date() }
        })
        .select('transactions expiresAt lastFetched')
        .lean();

        if (cachedTransactions) {
          return {
            data: cachedTransactions.transactions,
            pagination: {
              limit,
              nextCursor: this.extractNextCursor(cachedTransactions.transactions, limit),
              hasMore: cachedTransactions.transactions.length === limit,
              order,
            },
            cached: true,
          };
        }
      } catch (dbError) {
        logger.warn(`Error reading from transaction cache DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }

    // Fetch from Horizon
    try {
      
      let transactions: any[] = [];
      let nextCursor: string | undefined = undefined;

      try {
        // Try SDK first
        let builder = server.transactions().forAccount(publicKey).limit(limit).order(order);
        if (cursor) {
          // Validate cursor is not a transaction hash (hex)
          const isHexHash = /^[0-9a-f]{64}$/i.test(cursor);
          if (!isHexHash) {
            builder = builder.cursor(cursor);
          } else {
          }
        }

        const result = await builder.call();
        transactions = result.records;
        nextCursor = this.extractNextCursor(transactions, limit);
      } catch (sdkError: any) {
        // If SDK fails, try HTTP fallback
        const isNotFoundError =
          sdkError?.response?.status === 404 ||
          sdkError?.constructor?.name === 'NotFoundError' ||
          (sdkError?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found') ||
          (sdkError?.response?.data?.status === 404);

        if (isNotFoundError) {
          logger.warn(`SDK failed to fetch transactions for ${publicKey}, trying HTTP fallback...`);
          try {
            const horizonUrl = env.HORIZON_URL;
            let transactionsUrl = `${horizonUrl}/accounts/${publicKey}/transactions?limit=${limit}&order=${order}`;
            if (cursor) {
              const isHexHash = /^[0-9a-f]{64}$/i.test(cursor);
              if (!isHexHash) {
                transactionsUrl += `&cursor=${cursor}`;
              }
            }

            const response = await horizonQueue.get<any>(transactionsUrl, { timeout: 10000 }, 0);
            if (response && typeof response === 'object' && 'status' in response && 'data' in response) {
              const httpResponse = response as { status: number; data?: any };
              if (httpResponse.status === 200 && httpResponse.data?._embedded?.records) {
                transactions = httpResponse.data._embedded.records;
                nextCursor = this.extractNextCursor(transactions, limit);
              }
            }
          } catch (httpError: any) {
            logger.error(`HTTP fallback also failed for transactions: ${httpError?.message || String(httpError)}`);
            throw sdkError; // Throw original SDK error
          }
        } else {
          throw sdkError;
        }
      }

      // Format transactions
      const formattedTransactions = this.formatTransactions(transactions);

      // Cache the results
      if (useCache) {
        try {
          const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
          await TransactionCache.findOneAndUpdate(
            { publicKey, cursor: cacheKey },
            {
              publicKey,
              cursor: cacheKey,
              transactions: formattedTransactions,
              lastFetched: new Date(),
              expiresAt,
            },
            { upsert: true, new: true }
          );
        } catch (dbError) {
          logger.warn(`Failed to save transaction cache to DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        }
      }


      return {
        data: formattedTransactions,
        pagination: {
          limit,
          nextCursor,
          hasMore: formattedTransactions.length === limit && nextCursor !== undefined,
          order,
        },
        cached: false,
      };
    } catch (error: any) {
      logger.error(`❌ Error fetching transactions for account ${publicKey}:`, error);

      // Return cached data if available
      if (cachedTransactions && cachedTransactions.transactions.length > 0) {
        return {
          data: cachedTransactions.transactions,
          pagination: {
            limit,
            nextCursor: this.extractNextCursor(cachedTransactions.transactions, limit),
            hasMore: cachedTransactions.transactions.length === limit,
            order,
          },
          cached: true,
        };
      }

      // Cache error state (short TTL)
      if (useCache) {
        try {
          const expiresAt = new Date(Date.now() + CACHE_TTL_ERROR_MS);
          await TransactionCache.findOneAndUpdate(
            { publicKey, cursor: cacheKey },
            {
              publicKey,
              cursor: cacheKey,
              transactions: [],
              lastFetched: new Date(),
              expiresAt,
            },
            { upsert: true, new: true }
          );
        } catch (dbError) {
          // Ignore cache errors
        }
      }

      // Return empty result
      return {
        data: [],
        pagination: {
          limit,
          nextCursor: undefined,
          hasMore: false,
          order,
        },
        cached: false,
      };
    }
  }

  /**
   * Format transactions from Horizon API response
   */
  private formatTransactions(transactions: any[]): any[] {
    return transactions.map((tx: any) => {
      const base: any = {
        id: tx.id,
        hash: tx.hash,
        ledger: tx.ledger,
        createdAt: tx.created_at,
        sourceAccount: tx.source_account,
        fee: tx.fee_charged,
        feeAccount: tx.fee_account,
        operationCount: tx.operation_count,
        successful: tx.successful,
        paging_token: tx.paging_token,
      };

      // Add operation summaries if available
      if (tx.operations && Array.isArray(tx.operations)) {
        base.operations = tx.operations.map((op: any) => ({
          id: op.id,
          type: op.type,
          sourceAccount: op.source_account,
          createdAt: op.created_at,
        }));
      }

      // Add memo if present
      if (tx.memo) {
        base.memo = tx.memo;
        base.memoType = tx.memo_type;
      }

      return base;
    });
  }

  /**
   * Extract next cursor from transactions
   */
  private extractNextCursor(transactions: any[], limit: number): string | undefined {
    if (transactions.length === 0 || transactions.length < limit) {
      return undefined;
    }

    const lastTx = transactions[transactions.length - 1];
    return lastTx.paging_token || lastTx.id;
  }

  /**
   * Clear transaction cache for an account
   */
  public async clearTransactionCache(publicKey: string): Promise<void> {
    try {
      await TransactionCache.deleteMany({ publicKey });
      logger.info(`Cleared transaction cache for account ${publicKey}`);
    } catch (error) {
      logger.warn(`Failed to clear transaction cache for ${publicKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const transactionHistoryService = new TransactionHistoryService();

