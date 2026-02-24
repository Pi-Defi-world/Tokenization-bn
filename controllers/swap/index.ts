import { Request, Response } from 'express';
import { swapService } from '../../services/swap.service';
import { logger } from '../../utils/logger';
import { PoolService } from '../../services/liquidity-pools.service';
import { ensureTgeOpenForPool } from '../../middlewares/launchpad-guard';
import { errorBody, errorBodyFrom } from '../../utils/zyradex-error';

const poolService = new PoolService();

export const swapToken = async (req: Request, res: Response) => {
  try {
    const { userSecret, from, to, sendAmount } = req.body;

    if (!userSecret || !from || !to || !sendAmount)
      return res.status(400).json(errorBody('Please provide all swap details and try again.'));

    const result = await swapService.swapToken(userSecret, from, to, sendAmount);
    res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ swapToken failed:', err);
    const status = err?.status ?? err?.response?.status ?? 500;
    return res.status(status).json(errorBodyFrom(err));
  }
};

export const quoteSwap = async (req: Request, res: Response) => {
  try {
    const { poolId, from, to, amount, slippagePercent = 1, publicKey } = req.query;

    if (!poolId || !from || !to || !amount)
      return res.status(400).json(errorBody('Please select a pool and both tokens to get a quote.'));

    const tgeError = await ensureTgeOpenForPool(poolId as string);
    if (tgeError) return res.status(403).json(errorBody(tgeError));

    // Parse from/to - can be string "native" or "CODE:ISSUER" or object
    let fromAsset: { code: string; issuer?: string };
    let toAsset: { code: string; issuer?: string };

    if (typeof from === 'string') {
      if (from === 'native') {
        fromAsset = { code: 'native' };
      } else if (from.includes(':')) {
        const [code, issuer] = from.split(':');
        fromAsset = { code, issuer };
      } else {
        return res.status(400).json(errorBody('Please choose a valid token to swap from.'));
      }
    } else {
      return res.status(400).json(errorBody('Please choose a valid token to swap from.'));
    }

    if (typeof to === 'string') {
      if (to === 'native') {
        toAsset = { code: 'native' };
      } else if (to.includes(':')) {
        const [code, issuer] = to.split(':');
        toAsset = { code, issuer };
      } else {
        return res.status(400).json(errorBody('Please choose a valid token to receive.'));
      }
    } else {
      return res.status(400).json(errorBody('Please choose a valid token to receive.'));
    }

    const result = await swapService.quoteSwap(
      poolId as string,
      fromAsset,
      toAsset,
      amount as string,
      Number(slippagePercent),
      publicKey as string | undefined
    );

    return res.json(result);
  } catch (err: any) {
    logger.error(`❌ quoteSwap failed:`, err);
    const status = err?.status ?? err?.response?.status ?? 500;
    return res.status(status).json(errorBodyFrom(err));
  }
};

export const executeSwap = async (req: Request, res: Response) => {
  try {
    const { userSecret, poolId, from, to, sendAmount, slippagePercent = 1 } = req.body;

    if (!userSecret) return res.status(400).json(errorBody('Please sign in with your wallet to swap.'));
    if (!poolId) return res.status(400).json(errorBody('Please select a pool for this swap.'));
    if (!from) return res.status(400).json(errorBody('Please choose the token you are sending.'));
    if (!to) return res.status(400).json(errorBody('Please choose the token you want to receive.'));
    if (!sendAmount) return res.status(400).json(errorBody('Please enter the amount to swap.'));

    const tgeError = await ensureTgeOpenForPool(poolId);
    if (tgeError) return res.status(403).json(errorBody(tgeError));

    // Convert from/to objects to strings if needed
    const fromStr = typeof from === 'string'
      ? from
      : (from.code === 'native' ? 'native' : `${from.code}:${from.issuer || ''}`);
    const toStr = typeof to === 'string'
      ? to
      : (to.code === 'native' ? 'native' : `${to.code}:${to.issuer || ''}`);

    const result = await swapService.swapWithPool(
      userSecret,
      poolId,
      fromStr,
      toStr,
      String(sendAmount),
      slippagePercent
    );

    logger.success(`✅ Swap executed successfully via pool ${poolId}`);
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error(`❌ executeSwap failed:`, err);
    const status = err?.status ?? err?.response?.status ?? 500;
    return res.status(status).json(errorBodyFrom(err));
  }
};

export const getPoolsForPair = async (req: Request, res: Response) => {
  try {
    const { tokenA, tokenB } = req.query;
    if (!tokenA || !tokenB)
      return res.status(400).json(errorBody('Please select both tokens to see available pools.'));
    const norm = (s: string) => String(s ?? '').trim().replace(/^\/+|\/+$/g, '');
    logger.info(`🔹 Fetching pools for ${norm(tokenA as string)}/${norm(tokenB as string)}`);

    const useCache = req.query.cache !== 'false';
    const result = await swapService.getPoolsForPair(tokenA as string, tokenB as string, 50, useCache);
    res.json(result);
  } catch (err: any) {
    logger.error('❌ getPoolsForPair failed:', err);
    return res.status(500).json(errorBodyFrom(err));
  }
};

export const distributeFees = async (req: Request, res: Response) => {
  try {
    const { poolId } = req.body;
    if (!poolId) return res.status(400).json(errorBody('Please select a pool.'));

    const pool = await poolService.getLiquidityPoolById(poolId);
    const [resA, resB] = pool.reserves;

    const totalFeesA = (parseFloat(resA.amount) * 0.001).toFixed(7);
    const totalFeesB = (parseFloat(resB.amount) * 0.001).toFixed(7);

    logger.success(`✅ Distributed simulated fees for pool ${poolId}`);

    return res.json({
      success: true,
      message: `Distributed swap fees to LP holders`,
      distributed: { totalFeesA, totalFeesB },
    });
  } catch (err: any) {
    logger.error('❌ distributeFees failed:', err);
    return res.status(500).json(errorBodyFrom(err));
  }
};
