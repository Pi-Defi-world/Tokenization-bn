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
    try {
      const publicKey =
        (typeof req.query.publicKey === 'string' && req.query.publicKey) ||
        (typeof req.params.publicKey === 'string' && req.params.publicKey);

      if (!publicKey) {
        return res.status(400).json({ message: 'publicKey is required' });
      }

      // Check if client wants to bypass cache or force refresh
      const useCache = req.query.cache !== 'false';
      const forceRefresh = req.query.refresh === 'true';

      const result = await accountService.getBalances(publicKey, useCache, forceRefresh);
      
      // If using cached data, trigger background refresh for next time
      if (result.cached && !forceRefresh) {
        // Non-blocking background refresh
        accountService.refreshBalancesInBackground(publicKey).catch(() => {
          // Silently fail background refresh
        });
      }
      
      // Return 200 with the result (even if balances are empty)
      // The service handles "account not found" by returning empty balances
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('❌ getAccountBalance failed:', {
        error: err?.message || String(err),
        stack: err?.stack,
        response: err?.response?.data,
        status: err?.response?.status,
      });
      
      // Only return 500 for actual server errors, not for account not found
      const statusCode = err?.response?.status === 404 ? 200 : 500;
      return res.status(statusCode).json({ 
        message: 'Failed to fetch account balance', 
        error: err?.response?.data || err?.message || String(err)
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



