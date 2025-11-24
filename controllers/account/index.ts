import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { AccountService } from '../../services/account.service';

const accountService = new AccountService();

export const importAccount = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    const { mnemonic, secret } = req.body || {};

    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const result = await accountService.importAccount({
      mnemonic,
      secret,
      userId: currentUser._id.toString(),
    });

    return res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ importAccount failed:', err);
    const statusCode = err.message.includes('Invalid credentials') ? 400 : 500;
    return res.status(statusCode).json({ message: err.message || 'Failed to import account', error: err.message });
  }
};

export const getAccountBalance = async (req: Request, res: Response) => {
    // Extract publicKey outside try block so it's available in catch block
    const publicKey: string | undefined =
      (typeof req.query.publicKey === 'string' && req.query.publicKey) ||
      (typeof req.params.publicKey === 'string' && req.params.publicKey) ||
      undefined;

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    // At this point, TypeScript knows publicKey is a string (not undefined)
    const publicKeyString: string = publicKey;

    try {
      const useCache = req.query.cache !== 'false';
      const forceRefresh = req.query.refresh === 'true';

      const result = await accountService.getBalances(publicKeyString, useCache, forceRefresh);
      
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('❌ getAccountBalance failed:', {
        error: err?.message || String(err),
        stack: err?.stack,
        response: err?.response?.data,
        status: err?.response?.status,
      });
      
 
      try {
        const BalanceCache = require('../models/BalanceCache').default;
        const cached = await BalanceCache.findOne({ publicKey: publicKeyString });
        if (cached && cached.balances && cached.balances.length > 0) {
          logger.info(`Returning cached balances due to error for account ${publicKeyString}`);
          return res.status(200).json({
            publicKey: publicKeyString,
            balances: cached.balances,
            cached: true,
            accountExists: cached.accountExists ?? true
          });
        }
      } catch (cacheError) {
        // Ignore cache errors
      }
      
      // No cached data available - return empty balances
      return res.status(200).json({ 
        publicKey: publicKeyString,
        balances: [],
        cached: false,
        accountExists: null
      });
    }
  };
  
export const getAccountOperations = async (req: Request, res: Response) => {
  try {
    const publicKey =
      (typeof req.query.publicKey === 'string' && req.query.publicKey) ||
      (typeof req.params.publicKey === 'string' && req.params.publicKey);
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const order = (req.query.order as 'asc' | 'desc') || 'desc';

    const result = await accountService.getOperations({
      publicKey: publicKey || '',
      limit,
      cursor,
      order,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ getAccountOperations failed:', err);
    return res.status(500).json({
      message: 'Failed to fetch account operations',
      error: err.response?.data || err.message,
    });
  }
};



