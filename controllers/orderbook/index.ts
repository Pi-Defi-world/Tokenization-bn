
import { Request, Response } from "express";
import { getAssetFromCodeIssuer } from "../../utils/asset";
import { orderBookService } from "../../services/orderbook.service";
import { logger } from "../../utils/logger";


export async function getOrderBookHandler(req: Request, res: Response) {
  try {
    const { base, counter } = req.query;
    if (!base || !counter) return res.status(400).json({ success: false, message: "base and counter are required" });

    const baseAsset = getAssetFromCodeIssuer(String(base));
    const counterAsset = getAssetFromCodeIssuer(String(counter));

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
    const { base, counter, limit } = req.query;
    if (!base || !counter) {
      return res.status(400).json({ success: false, message: "base and counter are required" });
    }

    const baseAsset = getAssetFromCodeIssuer(String(base));
    const counterAsset = getAssetFromCodeIssuer(String(counter));
    const limitNum = limit ? parseInt(String(limit), 10) : 20;
    const validLimit = isNaN(limitNum) || limitNum <= 0 ? 20 : Math.min(limitNum, 100); // Max 100

    logger.info(`📊 Fetching trades for ${base}/${counter}, limit: ${validLimit}`);

    const trades = await orderBookService.getTrades(baseAsset, counterAsset, validLimit);
    return res.json({ success: true, trades, count: trades.length });
  } catch (err: any) {
    logger.error("getTradesHandler", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}

export async function getTradeAggregationsHandler(req: Request, res: Response) {
  try {
    const { base, counter, resolution, startTime, endTime, limit } = req.query;
    if (!base || !counter) {
      return res.status(400).json({ success: false, message: "base and counter are required" });
    }

    const baseAsset = getAssetFromCodeIssuer(String(base));
    const counterAsset = getAssetFromCodeIssuer(String(counter));
    const resolutionNum = resolution ? parseInt(String(resolution), 10) : 3600000; // Default 1 hour
    const limitNum = limit ? parseInt(String(limit), 10) : 24;
    const validLimit = isNaN(limitNum) || limitNum <= 0 ? 24 : Math.min(limitNum, 200); // Max 200

    const start = startTime ? new Date(String(startTime)) : undefined;
    const end = endTime ? new Date(String(endTime)) : undefined;

    logger.info(`📈 Fetching trade aggregations for ${base}/${counter}, resolution: ${resolutionNum}ms, limit: ${validLimit}`);

    const aggregations = await orderBookService.getTradeAggregations(
      baseAsset,
      counterAsset,
      resolutionNum,
      start,
      end,
      validLimit
    );
    return res.json({ success: true, aggregations, count: aggregations.length });
  } catch (err: any) {
    logger.error("getTradeAggregationsHandler", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}
