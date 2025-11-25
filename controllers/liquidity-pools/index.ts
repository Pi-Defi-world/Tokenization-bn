import { Request, Response } from 'express';
import { PoolService } from '../../services/liquidity-pools.service';
import { AccountService } from '../../services/account.service';
import { logger } from '../../utils/logger';

const poolService = new PoolService();
const accountService = new AccountService();

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
    
    // Handle pool exists error
    if (error.poolExists && error.poolId) {
      return res.status(409).json({
        message: `Pool already exists for ${req.body.tokenA?.code}/${req.body.tokenB?.code}`,
        poolExists: true,
        poolId: error.poolId,
        existingPool: error.existingPool,
        suggestion: 'Use the deposit endpoint to add liquidity to the existing pool',
      });
    }

    // Handle insufficient balance error
    if (error.message && error.message.includes('Insufficient balance')) {
      return res.status(400).json({
        message: error.message,
        reason: error.message,
      });
    }

    const reason = typeof error === 'string' ? error : (error.message || undefined);
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
    const useCache = req.query.cache !== 'false';

    const result = await poolService.getLiquidityPools(limit, cursor, useCache);

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

export const getUserTokens = async (req: Request, res: Response) => {
  try {
    const publicKey =
      (typeof req.query.publicKey === 'string' && req.query.publicKey) ||
      (typeof req.params.publicKey === 'string' && req.params.publicKey);

    if (!publicKey) {
      return res.status(400).json({ message: 'publicKey is required' });
    }

    const useCache = req.query.cache !== 'false';
    const result = await accountService.getBalances(publicKey, useCache);

    // Filter out liquidity pool shares and return only owned tokens
    const tokens = result.balances
      .filter((balance: any) => {
        // Exclude liquidity pool shares
        return balance.assetType !== 'liquidity_pool_shares';
      })
      .map((balance: any) => {
        // Format token information
        return {
          code: balance.assetCode,
          issuer: balance.assetIssuer || null,
          amount: balance.amount,
          assetType: balance.assetType,
        };
      });

    return res.status(200).json({
      publicKey,
      tokens,
      cached: result.cached,
    });
  } catch (error: any) {
    logger.error('getUserTokens failed:', error);
    return res.status(500).json({ message: 'Failed to fetch user tokens' });
  }
};

export const getPlatformPools = async (req: Request, res: Response) => {
  try {
    const useCache = req.query.cache !== 'false';

    const pools = await poolService.getPlatformPools(useCache);

    return res.status(200).json({
      pools,
      count: pools.length,
    });
  } catch (error: any) {
    logger.error('getPlatformPools failed:', error);
    return res.status(500).json({ message: 'Failed to fetch platform pools' });
  }
};

