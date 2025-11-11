import { Request, Response } from 'express';
import { PoolService } from '../../services/liquidity-pools.service';
import { logger } from '../../utils/logger';

const poolService = new PoolService();

export const createLiquidityPool = async (req: Request, res: Response) => {
  try {
    const { userSecret, tokenA, tokenB, amountA, amountB } = req.body || {};

    if (!userSecret || !tokenA?.code || !tokenB?.code || !amountA || !amountB) {
      return res.status(400).json({
        message:
          'Missing required fields: userSecret, tokenA { code, issuer }, tokenB { code, issuer }, amountA, amountB',
      });
    }

    const result = await poolService.createLiquidityPool(
      userSecret,
      { code: tokenA.code, issuer: tokenA.issuer },
      { code: tokenB.code, issuer: tokenB.issuer },
      String(amountA),
      String(amountB)
    );

    return res.status(201).json(result);
  } catch (error: any) {
    logger.error('createLiquidityPool failed:', error);
    const reason = typeof error === 'string' ? error : undefined;
    return res.status(500).json({ message: 'Failed to create liquidity pool', reason });
  }
};

export const depositToLiquidityPool = async (req: Request, res: Response) => {
  try {
    const { userSecret, poolId, amountA, amountB } = req.body || {};

    if (!userSecret || !poolId || !amountA || !amountB) {
      return res.status(400).json({
        message:
          'Missing required fields: userSecret, poolId, amountA, amountB',
      });
    }

    const result = await poolService.addLiquidity(
      userSecret,
      poolId,
      String(amountA),
      String(amountB),
    );

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('depositToLiquidityPool failed:', error);
    const reason = typeof error === 'string' ? error : undefined;
    return res.status(500).json({ message: 'Failed to deposit to liquidity pool', reason });
  }
};

export const withdrawFromLiquidityPool = async (req: Request, res: Response) => {
  try {
    // Expecting: userSecret, poolId, amount (amount of pool shares to redeem)
    const { userSecret, poolId, amount } = req.body || {};

    if (!userSecret || !poolId || !amount) {
      return res.status(400).json({
        message:
          'Missing required fields: userSecret, poolId, amount (shares to redeem)',
      });
    }

    const result = await poolService.removeLiquidity(
      userSecret,
      poolId,
      String(amount),
    );

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('withdrawFromLiquidityPool failed:', error);
    const reason = typeof error === 'string' ? error : undefined;
    return res.status(500).json({ message: 'Failed to withdraw from liquidity pool', reason });
  }
};

export const listLiquidityPools = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

    const result = await poolService.getLiquidityPools(limit, cursor);

    return res.status(200).json({
      data: result.records,
      pagination: {
        limit,
        nextCursor: result.nextCursor || null,
        hasMore: Boolean(result.nextCursor),
      },
    });
  } catch (error: any) {
    logger.error('listLiquidityPools failed:', error);
    return res.status(500).json({ message: 'Failed to fetch liquidity pools' });
  }
};

export const getLiquidityPoolById = async (req: Request, res: Response) => {
  try {
    const { liquidityPoolId } = req.params as { liquidityPoolId: string };
    if (!liquidityPoolId) {
      return res.status(400).json({ message: 'liquidityPoolId is required' });
    }

    const pool = await poolService.getLiquidityPoolById(liquidityPoolId);
    return res.status(200).json(pool);
  } catch (error: any) {
    logger.error('getLiquidityPoolById failed:', error);
    return res.status(500).json({ message: 'Failed to fetch liquidity pool' });
  }
};

export const getUserLiquidityReward = async (req: Request, res: Response) => {
  try {
    const { userPublicKey, poolId } = req.query as { userPublicKey?: string; poolId?: string };

    if (!userPublicKey) {
      return res.status(400).json({ message: 'userPublicKey is required' });
    }
    if (!poolId) {
      return res.status(400).json({ message: 'poolId is required' });
    }

    const reward = await poolService.getPoolRewards(userPublicKey, poolId);
    return res.status(200).json(reward);
  } catch (error: any) {
    logger.error('getLiquidityReward failed:', error);
    return res.status(500).json({ message: 'Failed to fetch liquidity reward' });
  }

};


export const getUserLiquidityPools = async (req: Request, res: Response) => {
  try {
    const userPublicKey =
      (typeof req.query.userPublicKey === 'string' && req.query.userPublicKey) ||
      (typeof req.body === 'object' && req.body && req.body.userPublicKey) ||
      (typeof req.params.userPublicKey === 'string' && req.params.userPublicKey);

    if (!userPublicKey) {
      return res.status(400).json({ message: 'userPublicKey is required' });
    }

    const reward = await poolService.getUserLiquidityPools(userPublicKey);
    return res.status(200).json(reward);
  } catch (error: any) {
    logger.error('getUserLiquidityPools failed:', error);
    return res.status(500).json({ message: 'Failed to fetch liquidity pools for user' });
  }
};

