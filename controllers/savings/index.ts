import { Request, Response } from 'express';
import { SavingsService } from '../../services/savings.service';
import { logger } from '../../utils/logger';
import { errorBody, errorBodyFrom } from '../../utils/zyradex-error';

const savingsService = new SavingsService();

export const getTermOptions = async (_req: Request, res: Response) => {
  try {
    const options = await savingsService.getTermOptions();
    return res.status(200).json({ data: options });
  } catch (error: any) {
    logger.error('getTermOptions failed:', error);
    return res.status(500).json(errorBodyFrom(error));
  }
};

export const listProducts = async (req: Request, res: Response) => {
  try {
    const asset = req.query.asset as string | undefined;
    let assetFilter: { code: string; issuer: string } | undefined;
    if (asset && asset.includes(':')) {
      const [code, issuer] = asset.split(':');
      if (code && issuer) assetFilter = { code, issuer };
    }
    const products = await savingsService.listProducts(assetFilter);
    return res.status(200).json({ data: products });
  } catch (error: any) {
    logger.error('listProducts failed:', error);
    return res.status(500).json(errorBodyFrom(error));
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    const { asset, termDays, apy, minAmount, active } = req.body || {};
    if (!asset?.code || !asset?.issuer || termDays == null || !apy) {
      return res.status(400).json(errorBody('Please provide asset, term, and rate to create a savings product.'));
    }
    const product = await savingsService.createProduct({
      asset: { code: asset.code, issuer: asset.issuer },
      termDays: Number(termDays),
      apy: String(apy),
      minAmount: minAmount != null ? String(minAmount) : '0',
      active,
    });
    return res.status(201).json(product);
  } catch (error: any) {
    logger.error('createProduct failed:', error);
    return res.status(500).json(errorBodyFrom(error));
  }
};

export const deposit = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? req.body?.userId;
    if (!userId) return res.status(400).json(errorBody('Please sign in or provide your user id.'));
    const { productId, amount, userSecret, depositAddress, termDays } = req.body || {};
    if (!productId || !amount) return res.status(400).json(errorBody('Please select a product and enter an amount.'));
    if (!userSecret) return res.status(400).json(errorBody('Please sign in with your wallet to deposit.'));
    const result = await savingsService.deposit({
      userId: String(userId),
      productId,
      amount: String(amount),
      userSecret,
      depositAddress,
      termDays: termDays != null ? Number(termDays) : undefined,
    });
    return res.status(201).json(result);
  } catch (error: any) {
    logger.error('deposit failed:', error);
    const status = error?.status ?? 400;
    return res.status(status).json(errorBodyFrom(error));
  }
};

export const listPositions = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? req.query.userId;
    if (!userId) return res.status(400).json(errorBody('Please sign in or provide your user id.'));
    const status = req.query.status as 'locked' | 'withdrawn' | undefined;
    const positions = await savingsService.listPositions(String(userId), status);
    return res.status(200).json({ data: positions });
  } catch (error: any) {
    logger.error('listPositions failed:', error);
    return res.status(500).json(errorBodyFrom(error));
  }
};

export const withdraw = async (req: Request, res: Response) => {
  try {
    const positionId = req.params.positionId as string;
    if (!positionId) return res.status(400).json(errorBody('Please specify which position to withdraw from.'));
    const result = await savingsService.withdraw(positionId);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('withdraw failed:', error);
    return res.status(400).json(errorBodyFrom(error));
  }
};
