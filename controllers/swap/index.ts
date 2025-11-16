import { Request, Response } from 'express';
import { swapService } from '../../services/swap.service';
import { logger } from '../../utils/logger';
import { PoolService } from '../../services/liquidity-pools.service';

const poolService = new PoolService();

export const swapToken = async (req: Request, res: Response) => {
  try {
    const { userSecret, from, to, sendAmount } = req.body;

    if (!userSecret || !from || !to || !sendAmount)
      return res.status(400).json({ success: false, message: 'Missing parameters' });

    const result = await swapService.swapToken(userSecret, from, to, sendAmount);
    res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ swapToken failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const quoteSwap = async (req: Request, res: Response) => {
  try {
    const { poolId, from, to, amount, slippagePercent = 1, publicKey } = req.query;

    if (!poolId || !from || !to || !amount)
      return res.status(400).json({ success: false, message: 'Missing parameters' });

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
        return res.status(400).json({ success: false, message: 'Invalid from format. Use "native" or "CODE:ISSUER"' });
      }
    } else {
      return res.status(400).json({ success: false, message: 'from must be a string' });
    }

    if (typeof to === 'string') {
      if (to === 'native') {
        toAsset = { code: 'native' };
      } else if (to.includes(':')) {
        const [code, issuer] = to.split(':');
        toAsset = { code, issuer };
      } else {
        return res.status(400).json({ success: false, message: 'Invalid to format. Use "native" or "CODE:ISSUER"' });
      }
    } else {
      return res.status(400).json({ success: false, message: 'to must be a string' });
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
    res.status(500).json({ success: false, error: err.message });
  }
};

export const executeSwap = async (req: Request, res: Response) => {
  try {
    const { userSecret, poolId, from, to, sendAmount, slippagePercent = 1 } = req.body;

    if (!userSecret)
      return res.status(400).json({ success: false, message: 'Missing userSecret' });
    if (!poolId)
      return res.status(400).json({ success: false, message: 'Missing poolId' });
    if (!from)
      return res.status(400).json({ success: false, message: 'Missing from' });
    if (!to)
      return res.status(400).json({ success: false, message: 'Missing to' });
    if (!sendAmount)
      return res.status(400).json({ success: false, message: 'Missing sendAmount' });

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
    
    // Return appropriate status code based on error type
    const statusCode = err?.status === 400 || err?.response?.status === 400 ? 400 : 500;
    return res.status(statusCode).json({ 
      success: false, 
      error: err.message || err.toString() 
    });
  }
};

export const getPoolsForPair = async (req: Request, res: Response) => {
  try {
    const { tokenA, tokenB } = req.query;
    if (!tokenA || !tokenB)
      return res.status(400).json({ success: false, message: 'Missing tokenA or tokenB' });

    logger.info(`🔹 Fetching pools for ${tokenA}/${tokenB}`);

    const result = await swapService.getPoolsForPair(tokenA as string, tokenB as string, 50);
    res.json(result);
  } catch (err: any) {
    logger.error('❌ getPoolsForPair failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const distributeFees = async (req: Request, res: Response) => {
  try {
    const { poolId } = req.body;
    if (!poolId)
      return res.status(400).json({ success: false, message: 'Missing poolId' });

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
    res.status(500).json({ success: false, error: err.message });
  }
};
