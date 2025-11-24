import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { tradeAnalyticsService } from '../../services/trade-analytics.service';

export const getTradeAggregations = async (req: Request, res: Response) => {
  try {
    const {
      baseAssetType,
      baseAssetCode,
      baseAssetIssuer,
      counterAssetType,
      counterAssetCode,
      counterAssetIssuer,
      startTime,
      endTime,
      resolution,
      offset,
      limit,
    } = req.query;

    if (!baseAssetType || !counterAssetType) {
      return res.status(400).json({
        success: false,
        message: 'baseAssetType and counterAssetType are required',
      });
    }

    const result = await tradeAnalyticsService.getTradeAggregations({
      baseAssetType: baseAssetType as string,
      baseAssetCode: baseAssetCode as string | undefined,
      baseAssetIssuer: baseAssetIssuer as string | undefined,
      counterAssetType: counterAssetType as string,
      counterAssetCode: counterAssetCode as string | undefined,
      counterAssetIssuer: counterAssetIssuer as string | undefined,
      startTime: startTime as string | undefined,
      endTime: endTime as string | undefined,
      resolution: resolution ? Number(resolution) : undefined,
      offset: offset ? Number(offset) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ getTradeAggregations failed:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch trade aggregations',
    });
  }
};

export const getTrades = async (req: Request, res: Response) => {
  try {
    const {
      baseAssetType,
      baseAssetCode,
      baseAssetIssuer,
      counterAssetType,
      counterAssetCode,
      counterAssetIssuer,
      cursor,
      limit,
      order,
    } = req.query;

    if (!baseAssetType || !counterAssetType) {
      return res.status(400).json({
        success: false,
        message: 'baseAssetType and counterAssetType are required',
      });
    }

    const result = await tradeAnalyticsService.getTrades({
      baseAssetType: baseAssetType as string,
      baseAssetCode: baseAssetCode as string | undefined,
      baseAssetIssuer: baseAssetIssuer as string | undefined,
      counterAssetType: counterAssetType as string,
      counterAssetCode: counterAssetCode as string | undefined,
      counterAssetIssuer: counterAssetIssuer as string | undefined,
      cursor: cursor as string | undefined,
      limit: limit ? Number(limit) : undefined,
      order: (order as 'asc' | 'desc') || 'desc',
    });

    return res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ getTrades failed:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch trades',
    });
  }
};

export const getPriceStats = async (req: Request, res: Response) => {
  try {
    const { base, counter, period } = req.query;

    if (!base || !counter) {
      return res.status(400).json({
        success: false,
        message: 'base and counter assets are required (format: "native" or "CODE:ISSUER")',
      });
    }

    // Parse base asset
    let baseAsset: { code: string; issuer?: string };
    if (base === 'native') {
      baseAsset = { code: 'native' };
    } else if (typeof base === 'string' && base.includes(':')) {
      const [code, issuer] = base.split(':');
      baseAsset = { code, issuer };
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid base asset format. Use "native" or "CODE:ISSUER"',
      });
    }

    // Parse counter asset
    let counterAsset: { code: string; issuer?: string };
    if (counter === 'native') {
      counterAsset = { code: 'native' };
    } else if (typeof counter === 'string' && counter.includes(':')) {
      const [code, issuer] = counter.split(':');
      counterAsset = { code, issuer };
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid counter asset format. Use "native" or "CODE:ISSUER"',
      });
    }

    const result = await tradeAnalyticsService.getPriceStats(
      baseAsset,
      counterAsset,
      (period as '24h' | '7d' | '30d') || '24h'
    );

    return res.status(200).json(result);
  } catch (err: any) {
    logger.error('❌ getPriceStats failed:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch price stats',
    });
  }
};

