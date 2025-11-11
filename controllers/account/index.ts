import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { AccountService } from '../../services/account.service';

const accountService = new AccountService();

export const importAccount = async (req: Request, res: Response) => {
  try {
    const { mnemonic, secret } = req.body || {};
    const result = await accountService.importAccount({ mnemonic, secret });
    return res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ importAccount failed:', err);
    return res.status(500).json({ message: 'Failed to import account', error: err.message });
  }
};

export const getAccountBalance = async (req: Request, res: Response) => {
    try {
      const publicKey =
        (typeof req.query.publicKey === 'string' && req.query.publicKey) ||
        (typeof req.params.publicKey === 'string' && req.params.publicKey);

      const result = await accountService.getBalances(publicKey || '');
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('❌ getAccountBalance failed:', err);
      return res
        .status(500)
        .json({ message: 'Failed to fetch account balance', error: err.response?.data || err.message });
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



