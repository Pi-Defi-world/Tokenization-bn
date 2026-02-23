import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { transactionHistoryService } from '../../services/transaction-history.service';

export const getAccountTransactions = async (req: Request, res: Response) => {
  const publicKey: string | undefined =
    (typeof req.query.publicKey === 'string' && req.query.publicKey) ||
    (typeof req.params.publicKey === 'string' && req.params.publicKey) ||
    undefined;

  if (!publicKey) {
    return res.status(400).json({ message: 'publicKey is required' });
  }

  try {
    const useCache = req.query.cache !== 'false';
    const forceRefresh = req.query.refresh === 'true';
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const order = (req.query.order as 'asc' | 'desc') || 'desc';

    const result = await transactionHistoryService.getTransactions(
      publicKey,
      limit,
      cursor,
      order,
      useCache,
      forceRefresh
    );

    return res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ getAccountTransactions failed:', err);

    // Try to return cached data on error
    try {
      const TransactionCache = require('../../models/TransactionCache').default;
      const cached = await TransactionCache.findOne({ 
        publicKey,
        expiresAt: { $gt: new Date() }
      })
      .select('transactions cursor')
      .lean();

      if (cached && cached.transactions && cached.transactions.length > 0) {
        logger.info(`Returning cached transactions due to error for account ${publicKey}`);
        const limit = req.query.limit ? Number(req.query.limit) : 20;
        const order = (req.query.order as 'asc' | 'desc') || 'desc';
        
        return res.status(200).json({
          data: cached.transactions,
          pagination: {
            limit,
            nextCursor: cached.transactions.length === limit 
              ? (cached.transactions[cached.transactions.length - 1]?.paging_token || undefined)
              : undefined,
            hasMore: cached.transactions.length === limit,
            order,
          },
          cached: true,
        });
      }
    } catch (cacheError) {
      // Ignore cache errors
    }

    // Return empty result
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const order = (req.query.order as 'asc' | 'desc') || 'desc';
    
    return res.status(200).json({
      data: [],
      pagination: {
        limit,
        nextCursor: undefined,
        hasMore: false,
        order,
      },
      cached: false,
    });
  }
};

