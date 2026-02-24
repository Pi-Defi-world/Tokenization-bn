import { Request, Response } from 'express';
import { LendingService } from '../../services/lending.service';
import { CreditScoreService } from '../../services/credit-score.service';
import { getPricesInPi } from '../../services/price.service';
import { getPlatformFeePublicKey } from '../../config/lending';
import { logger } from '../../utils/logger';

const lendingService = new LendingService();
const creditScoreService = new CreditScoreService();

function getPoolIdParam(req: Request): string {
  const p = req.params.poolId;
  return Array.isArray(p) ? p[0] : p;
}

export const listPools = async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active !== 'false';
    const pools = await lendingService.listPools(activeOnly);
    return res.status(200).json({ data: pools });
  } catch (error: any) {
    logger.error('listPools failed:', error);
    return res.status(500).json({ message: 'Failed to list lending pools' });
  }
};

export const createPool = async (req: Request, res: Response) => {
  try {
    const { asset, supplyRate, borrowRate, collateralFactor, collateralAssets } = req.body || {};
    if (!asset?.code || !asset?.issuer || !supplyRate || !borrowRate || !collateralFactor) {
      return res.status(400).json({
        message: 'Missing required: asset { code, issuer }, supplyRate, borrowRate, collateralFactor',
      });
    }
    const pool = await lendingService.createPool({
      asset: { code: asset.code, issuer: asset.issuer },
      supplyRate: String(supplyRate),
      borrowRate: String(borrowRate),
      collateralFactor: String(collateralFactor),
      collateralAssets,
    });
    return res.status(201).json(pool);
  } catch (error: any) {
    logger.error('createPool failed:', error);
    return res.status(500).json({ message: error?.message || 'Failed to create pool' });
  }
};

export const supply = async (req: Request, res: Response) => {
  try {
    const poolId = getPoolIdParam(req);
    const userId = (req as any).user?.id ?? req.body?.userId;
    if (!userId) return res.status(400).json({ message: 'userId required (auth or body)' });
    const { amount, userSecret } = req.body || {};
    if (!amount) return res.status(400).json({ message: 'Missing required: amount' });
    if (!userSecret) return res.status(400).json({ message: 'userSecret required to sign the supply transaction' });
    const position = await lendingService.supply(poolId, String(userId), String(amount), userSecret);
    return res.status(200).json(position);
  } catch (error: any) {
    logger.error('supply failed:', error);
    return res.status(400).json({ message: error?.message || 'Supply failed' });
  }
};

export const withdraw = async (req: Request, res: Response) => {
  try {
    const poolId = getPoolIdParam(req);
    const userId = (req as any).user?.id ?? req.body?.userId;
    if (!userId) return res.status(400).json({ message: 'userId required (auth or body)' });
    const { amount } = req.body || {};
    if (!amount) return res.status(400).json({ message: 'Missing required: amount' });
    const result = await lendingService.withdraw(poolId, String(userId), String(amount));
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('withdraw failed:', error);
    return res.status(400).json({ message: error?.message || 'Withdraw failed' });
  }
};

export const borrow = async (req: Request, res: Response) => {
  try {
    const poolId = getPoolIdParam(req);
    const userId = (req as any).user?.id ?? req.body?.userId;
    if (!userId) return res.status(400).json({ message: 'userId required (auth or body)' });
    const { collateralAsset, collateralAmount, borrowAmount, userSecret } = req.body || {};
    if (!collateralAsset?.code || !collateralAsset?.issuer || !collateralAmount || !borrowAmount) {
      return res.status(400).json({
        message: 'Missing required: collateralAsset { code, issuer }, collateralAmount, borrowAmount',
      });
    }
    if (!userSecret) return res.status(400).json({ message: 'userSecret required to sign the borrow transaction' });
    const position = await lendingService.borrow(
      poolId,
      String(userId),
      { code: collateralAsset.code, issuer: collateralAsset.issuer },
      String(collateralAmount),
      String(borrowAmount),
      userSecret
    );
    return res.status(201).json(position);
  } catch (error: any) {
    logger.error('borrow failed:', error);
    return res.status(400).json({ message: error?.message || 'Borrow failed' });
  }
};

export const getPositions = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? req.query.userId;
    if (!userId) return res.status(400).json({ message: 'userId required (auth or query)' });
    const result = await lendingService.getPositions(String(userId));
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('getPositions failed:', error);
    return res.status(500).json({ message: 'Failed to get positions' });
  }
};

export const repay = async (req: Request, res: Response) => {
  try {
    const borrowPositionId = req.params.borrowPositionId as string;
    const { amount, userSecret } = req.body || {};
    if (!borrowPositionId || !amount) return res.status(400).json({ message: 'Missing: borrowPositionId (param), amount' });
    if (!userSecret) return res.status(400).json({ message: 'userSecret required to sign the repay transaction' });
    const result = await lendingService.repay(borrowPositionId, String(amount), userSecret);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('repay failed:', error);
    return res.status(400).json({ message: error?.message || 'Repay failed' });
  }
};

export const liquidate = async (req: Request, res: Response) => {
  try {
    const borrowPositionId = req.params.borrowPositionId as string;
    const liquidatorUserId = (req as any).user?.id ?? req.body?.userId;
    const { repayAmount, userSecret: liquidatorSecret } = req.body || {};
    if (!borrowPositionId || !repayAmount || !liquidatorUserId) {
      return res.status(400).json({ message: 'Missing: borrowPositionId (param), repayAmount, userId (auth or body)' });
    }
    if (!liquidatorSecret?.trim()) {
      return res.status(400).json({ message: 'userSecret required to sign repay and receive collateral onchain' });
    }
    const result = await lendingService.liquidate(borrowPositionId, String(repayAmount), String(liquidatorUserId), liquidatorSecret);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('liquidate failed:', error);
    return res.status(400).json({ message: error?.message || 'Liquidation failed' });
  }
};

export const getPrices = async (req: Request, res: Response) => {
  try {
    const assets = (req.query.assets as string) || '';
    const list = assets ? assets.split(',').map((s) => {
      const [code, issuer] = s.split(':');
      return { code: code || '', issuer: issuer || '' };
    }).filter((a) => a.code) : [];
    const prices = await getPricesInPi(list);
    return res.status(200).json(prices);
  } catch (error: any) {
    logger.error('getPrices failed:', error);
    return res.status(500).json({ message: 'Failed to get prices' });
  }
};

/** Get credit score for a user. Includes maxBorrowTermDays and hasHistory for term eligibility (98+ with history = max term). */
export const getCreditScore = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? req.query.userId;
    if (!userId) return res.status(400).json({ message: 'userId required (query or auth)' });
    const data = await creditScoreService.getScoreWithTerms(String(userId));
    return res.status(200).json({
      score: data.score,
      canBorrow: data.canBorrow,
      reason: data.reason,
      maxBorrowTermDays: data.maxBorrowTermDays,
      hasHistory: data.hasHistory,
    });
  } catch (error: any) {
    logger.error('getCreditScore failed:', error);
    return res.status(500).json({ message: 'Failed to get credit score' });
  }
};

/** Set credit score (e.g. by backend/admin). Score 0-100. */
export const setCreditScore = async (req: Request, res: Response) => {
  try {
    const { userId, score } = req.body || {};
    if (!userId || score == null) return res.status(400).json({ message: 'Missing required: userId, score' });
    const result = await creditScoreService.setScore(String(userId), Number(score));
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('setCreditScore failed:', error);
    return res.status(400).json({ message: error?.message || 'Failed to set credit score' });
  }
};

/** Where platform fees are sent (Stellar public key). */
export const getFeeDestination = async (_req: Request, res: Response) => {
  const publicKey = getPlatformFeePublicKey();
  return res.status(200).json({ platformFeePublicKey: publicKey || null });
};
