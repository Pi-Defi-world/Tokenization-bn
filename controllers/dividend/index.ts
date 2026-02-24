import { Request, Response } from 'express';
import { DividendService } from '../../services/dividend.service';
import { logger } from '../../utils/logger';

const dividendService = new DividendService();

function getRoundIdParam(req: Request): string {
  const p = req.params.roundId;
  return Array.isArray(p) ? p[0] : p;
}

export const createRound = async (req: Request, res: Response) => {
  try {
    const launchId = (req.params.launchId as string) || (Array.isArray(req.params.launchId) ? req.params.launchId[0] : '');
    const { recordAt, totalPayoutAmount } = req.body || {};
    if (!launchId || !totalPayoutAmount) {
      return res.status(400).json({ message: 'Missing required: launchId (param), totalPayoutAmount' });
    }
    const round = await dividendService.createRound(launchId, {
      recordAt: recordAt ? new Date(recordAt) : new Date(),
      totalPayoutAmount: String(totalPayoutAmount),
    });
    return res.status(201).json(round);
  } catch (error: any) {
    logger.error('createRound failed:', error);
    return res.status(400).json({ message: error?.message || 'Failed to create dividend round' });
  }
};

export const runSnapshot = async (req: Request, res: Response) => {
  try {
    const roundId = getRoundIdParam(req);
    const result = await dividendService.runSnapshot(roundId);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error('runSnapshot failed:', error);
    return res.status(400).json({ message: error?.message || 'Failed to run snapshot' });
  }
};

export const getRound = async (req: Request, res: Response) => {
  try {
    const roundId = getRoundIdParam(req);
    const round = await dividendService.getRound(roundId);
    if (!round) return res.status(404).json({ message: 'Dividend round not found' });
    return res.status(200).json(round);
  } catch (error: any) {
    logger.error('getRound failed:', error);
    return res.status(500).json({ message: 'Failed to fetch dividend round' });
  }
};

export const getHolders = async (req: Request, res: Response) => {
  try {
    const roundId = getRoundIdParam(req);
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
    const cursor = (req.query.cursor as string) || undefined;
    const { records, nextCursor } = await dividendService.getHolders(roundId, limit, cursor);
    return res.status(200).json({ data: records, nextCursor: nextCursor || undefined });
  } catch (error: any) {
    logger.error('getHolders failed:', error);
    return res.status(500).json({ message: 'Failed to fetch holders' });
  }
};

export const recordClaim = async (req: Request, res: Response) => {
  try {
    const roundId = getRoundIdParam(req);
    const { publicKey, txHash } = req.body || {};
    if (!publicKey || !txHash) {
      return res.status(400).json({ message: 'Missing required: publicKey, txHash' });
    }
    const snap = await dividendService.recordClaim(roundId, publicKey, txHash);
    return res.status(200).json(snap);
  } catch (error: any) {
    logger.error('recordClaim failed:', error);
    return res.status(400).json({ message: error?.message || 'Failed to record claim' });
  }
};
