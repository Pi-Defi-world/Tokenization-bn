
import { Request, Response } from "express";
import { getAssetFromCodeIssuer } from "../../utils/asset";
import { orderBookService } from "../../services/orderbook.service";
import { tradeAnalyticsService } from "../../services/trade-analytics.service";
import { logger } from "../../utils/logger";


export async function getOrderBookHandler(req: Request, res: Response) {
  try {
    const { base, counter } = req.query;
    if (!base || !counter) return res.status(400).json({ success: false, message: "base and counter are required" });

    // Validate counter asset format - must be "native" or "CODE:ISSUER"
    const counterStr = String(counter).trim();
    if (counterStr !== "native" && !counterStr.includes(":")) {
      return res.status(400).json({ 
        success: false, 
        message: "Counter asset must be 'native' or in 'CODE:ISSUER'"
      });
    }

    const baseAsset = getAssetFromCodeIssuer(String(base));
    const counterAsset = getAssetFromCodeIssuer(counterStr);

    const book = await orderBookService.getOrderBook(baseAsset, counterAsset);
    return res.json({ success: true, book });
  } catch (err: any) {
    logger.error("getOrderBookHandler", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}

export async function getOffersByAccountHandler(req: Request, res: Response) {
  try {
    const accountId = req.params.account;
    if (!accountId) return res.status(400).json({ success: false, message: "account required" });

    const offers = await orderBookService.getOffersByAccount(accountId);
    return res.json({ success: true, offers });
  } catch (err: any) {
    logger.error("getOffersByAccountHandler", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}

export async function getTradesHandler(req: Request, res: Response) {
  try {
    const { base, counter, limit, cursor, order } = req.query;
    if (!base || !counter) {
      return res.status(400).json({ success: false, message: "base and counter are required" });
    }

    // Validate counter asset format - must be "native" or "CODE:ISSUER"
    const counterStr = String(counter).trim();
    if (counterStr !== "native" && !counterStr.includes(":")) {
      return res.status(400).json({ 
        success: false, 
        message: "Counter asset must be 'native' or in 'CODE:ISSUER' format (e.g., Archimedes:GBP7HXY4QXLKZBKIUR75Y6I3OHB2CQLAUA2FV2LCNDRPP54TZLNBSENX)" 
      });
    }

    const baseAsset = getAssetFromCodeIssuer(String(base));
    const counterAsset = getAssetFromCodeIssuer(counterStr);
    const limitNum = limit ? parseInt(String(limit), 10) : 50;
    const validLimit = isNaN(limitNum) || limitNum <= 0 ? 50 : Math.min(limitNum, 200); // Max 200

    logger.info(`📊 Fetching trades for ${base}/${counter}, limit: ${validLimit}`);

    // Use new trade analytics service
    const baseAssetType = baseAsset.code === 'native' ? 'native' : 'credit_alphanum4';
    const counterAssetType = counterAsset.code === 'native' ? 'native' : 'credit_alphanum4';

    const result = await tradeAnalyticsService.getTrades({
      baseAssetType,
      baseAssetCode: baseAsset.code === 'native' ? undefined : baseAsset.code,
      baseAssetIssuer: baseAsset.issuer,
      counterAssetType,
      counterAssetCode: counterAsset.code === 'native' ? undefined : counterAsset.code,
      counterAssetIssuer: counterAsset.issuer,
      cursor: cursor as string | undefined,
      limit: validLimit,
      order: (order as 'asc' | 'desc') || 'desc',
    });

    return res.json({ success: true, ...result, count: result.data.length });
  } catch (err: any) {
    logger.error("getTradesHandler", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}

export async function getTradeAggregationsHandler(req: Request, res: Response) {
  try {
    const { base, counter, resolution, startTime, endTime, limit, offset } = req.query;
    if (!base || !counter) {
      return res.status(400).json({ success: false, message: "base and counter are required" });
    }

    const baseAsset = getAssetFromCodeIssuer(String(base));
    const counterAsset = getAssetFromCodeIssuer(String(counter));
    
    // Resolution in seconds (not milliseconds) for Horizon API
    const resolutionNum = resolution ? parseInt(String(resolution), 10) : 3600; // Default 1 hour in seconds
    const limitNum = limit ? parseInt(String(limit), 10) : 200;
    const validLimit = isNaN(limitNum) || limitNum <= 0 ? 200 : Math.min(limitNum, 200); // Max 200

    logger.info(`📈 Fetching trade aggregations for ${base}/${counter}, resolution: ${resolutionNum}s, limit: ${validLimit}`);

    // Use new trade analytics service
    const baseAssetType = baseAsset.code === 'native' ? 'native' : 'credit_alphanum4';
    const counterAssetType = counterAsset.code === 'native' ? 'native' : 'credit_alphanum4';

    const result = await tradeAnalyticsService.getTradeAggregations({
      baseAssetType,
      baseAssetCode: baseAsset.code === 'native' ? undefined : baseAsset.code,
      baseAssetIssuer: baseAsset.issuer,
      counterAssetType,
      counterAssetCode: counterAsset.code === 'native' ? undefined : counterAsset.code,
      counterAssetIssuer: counterAsset.issuer,
      startTime: startTime ? new Date(String(startTime)).toISOString() : undefined,
      endTime: endTime ? new Date(String(endTime)).toISOString() : undefined,
      resolution: resolutionNum,
      offset: offset ? Number(offset) : undefined,
      limit: validLimit,
    });

    return res.json({ success: true, ...result, count: result.data.length });
  } catch (err: any) {
    logger.error("getTradeAggregationsHandler", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}
