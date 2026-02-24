import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { AccountService } from '../../services/account.service';
import WalletService from '../../services/wallet.service';
import { errorBody, errorBodyFrom } from '../../utils/zyradex-error';

const accountService = new AccountService();
const walletService = new WalletService();

export const createWallet = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;

    if (!currentUser) return res.status(401).json(errorBody('Please sign in to create a wallet.'));

    const userId = currentUser._id.toString();
    logger.info(`Creating new wallet for user ${userId}`);

    const result = await walletService.generateAndLinkWallet(userId);

    const replacedPreviousWallet = result.previousPublicKey != null && result.previousPublicKey !== '';
    const warning = replacedPreviousWallet
      ? 'You have replaced your previous wallet. The old wallet address is no longer linked to this account. Any funds or data tied to the old address are not automatically transferred. Store your new secret key securely.'
      : undefined;

    return res.status(200).json({
      publicKey: result.publicKey,
      secret: result.secretKey,
      seedResult: result.seedResult,
      replacedPreviousWallet,
      previousPublicKey: result.previousPublicKey ?? null,
      warning,
    });
  } catch (err: any) {
    logger.error('❌ createWallet failed:', err);
    const status = err?.message?.includes('User not found') || err?.message?.includes('PI_TEST_USER_SECRET_KEY') ? 400 : 500;
    return res.status(status).json(errorBodyFrom(err));
  }
};

/**
 * Change wallet: replace the user's current wallet with a new one.
 * Requires body.confirmReplace === true. Use when user already has a wallet (public_key).
 * Returns same shape as createWallet, with warning and replacedPreviousWallet set.
 */
export const changeWallet = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;

    if (!currentUser) return res.status(401).json(errorBody('Please sign in to change your wallet.'));

    const confirmReplace = req.body?.confirmReplace === true;
    if (!confirmReplace) return res.status(400).json(errorBody('You must confirm that you want to replace your wallet.'));

    const existingPublicKey = currentUser.public_key != null && String(currentUser.public_key).trim() !== '';
    if (!existingPublicKey) return res.status(400).json(errorBody('You don\'t have a wallet yet. Create one first.'));

    const userId = currentUser._id.toString();
    logger.info(`Changing wallet for user ${userId}, previous: ${currentUser.public_key}`);

    const result = await walletService.generateAndLinkWallet(userId);

    const warning =
      'You have replaced your previous wallet. The old wallet address is no longer linked to this account. Any funds or data tied to the old address are not automatically transferred. Store your new secret key securely.';

    return res.status(200).json({
      publicKey: result.publicKey,
      secret: result.secretKey,
      seedResult: result.seedResult,
      replacedPreviousWallet: true,
      previousPublicKey: result.previousPublicKey ?? null,
      warning,
    });
  } catch (err: any) {
    logger.error('❌ changeWallet failed:', err);
    const status = err?.message?.includes('User not found') || err?.message?.includes('PI_TEST_USER_SECRET_KEY') ? 400 : 500;
    return res.status(status).json(errorBodyFrom(err));
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
    return res.status(500).json(errorBodyFrom(err));
  }
};



