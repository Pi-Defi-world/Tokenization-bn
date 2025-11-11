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
    const { poolId, from, to, amount, slippagePercent = 1 } = req.query;

    if (!poolId || !from || !to || !amount)
      return res.status(400).json({ success: false, message: 'Missing parameters' });

    const pool = await poolService.getLiquidityPoolById(poolId as string);
    const [resA, resB] = pool.reserves;

    const x = parseFloat(resA.amount);
    const y = parseFloat(resB.amount);
    const input = parseFloat(amount as string);
    const fee = pool.fee_bp / 10000;

    const isAtoB = resA.asset.includes((from as string));
    const inputReserve = isAtoB ? x : y;
    const outputReserve = isAtoB ? y : x;

    const inputAfterFee = input * (1 - fee);
    const outputAmount = (inputAfterFee * outputReserve) / (inputReserve + inputAfterFee);
    const minOut = (outputAmount * (1 - Number(slippagePercent) / 100)).toFixed(7);

    logger.info(
      `💱 Quote: ${input} ${from} -> ~${outputAmount.toFixed(7)} ${to} (minOut: ${minOut})`
    );

    return res.json({
      success: true,
      expectedOutput: outputAmount.toFixed(7),
      minOut,
      slippagePercent,
      fee: pool.fee_bp / 100,
      poolId,
    });
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

    const result = await swapService.swapWithPool(
      userSecret,
      poolId,
      from,
      to,
      sendAmount,
      slippagePercent
    );

    logger.success(`✅ Swap executed successfully via pool ${poolId}`);
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error(`❌ executeSwap failed:`, err);
    res.status(500).json({ success: false, error: err.message });
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
