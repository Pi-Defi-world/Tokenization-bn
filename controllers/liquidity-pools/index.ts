import { Request, Response } from 'express';
import { PoolService } from '../../services/liquidity-pools.service';
import { AccountService } from '../../services/account.service';
import { ensureTgeOpenForPool } from '../../middlewares/launchpad-guard';
import { logger } from '../../utils/logger';
import { errorBody, errorBodyFrom } from '../../utils/zyradex-error';

const poolService = new PoolService();
const accountService = new AccountService();

export const createLiquidityPool = async (req: Request, res: Response) => {
  try {
    const { userSecret, tokenA, tokenB, amountA, amountB } = req.body || {};

    if (!userSecret || !tokenA?.code || !tokenB?.code || !amountA || !amountB) {
      return res.status(400).json(errorBody('Please sign in and provide both tokens and amounts to create a pool.'));
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
    logger.error('Error details:', {
      message: error?.message,
      operationError: error?.operationError,
      resultCodes: error?.resultCodes,
      response: error?.response?.data,
    });
    
    if (error.poolExists && error.poolId) {
      return res.status(409).json(errorBody('A pool for this token pair already exists. You can add liquidity to it instead.'));
    }
    const status = error?.status ?? error?.response?.status ?? 500;
    return res.status(status).json(errorBodyFrom(error));
  }
};

export const depositToLiquidityPool = async (req: Request, res: Response) => {
  try {
    const { userSecret, poolId, amountA, amountB } = req.body || {};

    if (!userSecret || !poolId || !amountA || !amountB) {
      return res.status(400).json(errorBody('Please sign in and provide the pool and both amounts to add liquidity.'));
    }

    const tgeError = await ensureTgeOpenForPool(poolId);
    if (tgeError) return res.status(403).json(errorBody(tgeError));

    const result = await poolService.addLiquidity(
      userSecret,
      poolId,
      String(amountA),
      String(amountB),
    );

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('depositToLiquidityPool failed:', error);
    const status = error?.status ?? error?.response?.status ?? 500;
    return res.status(status).json(errorBodyFrom(error));
  }
};

export const withdrawFromLiquidityPool = async (req: Request, res: Response) => {
  try {
    // Expecting: userSecret, poolId, amount (amount of pool shares to redeem)
    const { userSecret, poolId, amount } = req.body || {};

    if (!userSecret || !poolId || !amount) {
      return res.status(400).json(errorBody('Please sign in and provide the pool and amount of shares to withdraw.'));
    }

    const tgeError = await ensureTgeOpenForPool(poolId);
    if (tgeError) return res.status(403).json(errorBody(tgeError));

    const result = await poolService.removeLiquidity(
      userSecret,
      poolId,
      String(amount),
    );

    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('withdrawFromLiquidityPool failed:', error);
    const status = error?.status ?? error?.response?.status ?? 500;
    return res.status(status).json(errorBodyFrom(error));
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
    return res.status(500).json(errorBodyFrom(error));
  }
};

export const getLiquidityPoolById = async (req: Request, res: Response) => {
  try {
    const { liquidityPoolId } = req.params as { liquidityPoolId: string };
    if (!liquidityPoolId) return res.status(400).json(errorBody('Please provide a pool id.'));

    const pool = await poolService.getLiquidityPoolById(liquidityPoolId);
    return res.status(200).json(pool);
  } catch (error: any) {
    logger.error('getLiquidityPoolById failed:', error);
    return res.status(500).json(errorBodyFrom(error));
  }
};

export const getUserLiquidityReward = async (req: Request, res: Response) => {
  try {
    const { userPublicKey, poolId } = req.query as { userPublicKey?: string; poolId?: string };

    if (!userPublicKey) return res.status(400).json(errorBody('Please provide your wallet address.'));
    if (!poolId) return res.status(400).json(errorBody('Please provide a pool.'));

    const reward = await poolService.getPoolRewards(userPublicKey, poolId);
    return res.status(200).json(reward);
  } catch (error: any) {
    logger.error('getLiquidityReward failed:', error);
    return res.status(500).json(errorBodyFrom(error));
  }
};


export const getUserLiquidityPools = async (req: Request, res: Response) => {
  try {
    const userPublicKey =
      (typeof req.query.userPublicKey === 'string' && req.query.userPublicKey) ||
      (typeof req.body === 'object' && req.body && req.body.userPublicKey) ||
      (typeof req.params.userPublicKey === 'string' && req.params.userPublicKey);

    if (!userPublicKey) return res.status(400).json(errorBody('Please provide your wallet address.'));

    const reward = await poolService.getUserLiquidityPools(userPublicKey);
    return res.status(200).json(reward);
  } catch (error: any) {
    logger.error('getUserLiquidityPools failed:', error);
    return res.status(500).json(errorBodyFrom(error));
  }
};

export const getUserTokens = async (req: Request, res: Response) => {
  try {
    const publicKey =
      (typeof req.query.publicKey === 'string' && req.query.publicKey) ||
      (typeof req.params.publicKey === 'string' && req.params.publicKey);

    if (!publicKey) return res.status(400).json(errorBody('Please provide your wallet address.'));

    const useCache = req.query.cache !== 'false';
    const result = await accountService.getBalances(publicKey, useCache);

    if (!result) return res.status(500).json(errorBody('We couldn\'t load your balances. Please try again.'));

    // Filter out liquidity pool shares and return only owned tokens
    const tokens = (result.balances || [])
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
      cached: result.cached || false,
    });
  } catch (error: any) {
    logger.error('getUserTokens failed:', error);
    return res.status(500).json(errorBodyFrom(error));
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
    return res.status(500).json(errorBodyFrom(error));
  }
};

export const quoteAddLiquidity = async (req: Request, res: Response) => {
  try {
    const { poolId, amountA } = req.query as { poolId?: string; amountA?: string };

    if (!poolId || !amountA) return res.status(400).json(errorBody('Please select a pool and enter an amount.'));

    const quote = await poolService.quoteAddLiquidity(poolId, amountA);

    return res.status(200).json({
      success: true,
      ...quote,
    });
  } catch (error: any) {
    logger.error('quoteAddLiquidity failed:', error);
    return res.status(500).json(errorBodyFrom(error));
  }
};

