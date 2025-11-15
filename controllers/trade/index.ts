
import { Request, Response } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { tradeService } from "../../services/trade.service";
import { getAssetFromCodeIssuer } from "../../utils/asset";
import { logger } from "../../utils/logger";

export async function createSellOfferHandler(req: Request, res: Response) {
  try {
    const { userSecret, selling, buying, amount, price } = req.body;
    if (!userSecret || !selling || !buying || !amount || !price) {
      return res.status(400).json({ success: false, message: "missing params" });
    }

    const sellingAsset = getAssetFromCodeIssuer(selling);
    const buyingAsset = getAssetFromCodeIssuer(buying);

    const result = await tradeService.createSellOffer(userSecret, sellingAsset, buyingAsset, String(amount), String(price));
    return res.json({ success: true, result });
  } catch (err: any) {
    logger.error("createSellOfferHandler error", {
      message: err?.message || String(err),
      stack: err?.stack,
      response: err?.response?.data,
    });
    
    // Return appropriate status code based on error type
    const statusCode = err?.response?.status === 400 ? 400 : 500;
    return res.status(statusCode).json({ 
      success: false, 
      message: err.message || err.toString() 
    });
  }
}

export async function createBuyOfferHandler(req: Request, res: Response) {
  try {
    const { userSecret, buying, selling, buyAmount, price } = req.body;
    if (!userSecret || !selling || !buying || !buyAmount || !price) {
      return res.status(400).json({ success: false, message: "missing params" });
    }

    const sellingAsset = getAssetFromCodeIssuer(selling);
    const buyingAsset = getAssetFromCodeIssuer(buying);

    const result = await tradeService.createBuyOffer(userSecret, buyingAsset, sellingAsset, String(buyAmount), String(price));
    return res.json({ success: true, result });
  } catch (err: any) {
    logger.error("createBuyOfferHandler error", {
      message: err?.message || String(err),
      stack: err?.stack,
      response: err?.response?.data,
    });
    
    const statusCode = err?.response?.status === 400 ? 400 : 500;
    return res.status(statusCode).json({ 
      success: false, 
      message: err.message || err.toString() 
    });
  }
}

export async function cancelOfferHandler(req: Request, res: Response) {
  try {
    const { userSecret, selling, buying, offerId } = req.body;
    if (!userSecret || !selling || !buying || !offerId) return res.status(400).json({ success: false, message: "missing params" });

    const sellingAsset = getAssetFromCodeIssuer(selling);
    const buyingAsset = getAssetFromCodeIssuer(buying);

    const result = await tradeService.cancelSellOffer(userSecret, sellingAsset, buyingAsset, String(offerId));
    return res.json({ success: true, result });
  } catch (err: any) {
    logger.error("cancelOfferHandler error", {
      message: err?.message || String(err),
      stack: err?.stack,
      response: err?.response?.data,
    });
    
    const statusCode = err?.response?.status === 400 ? 400 : 500;
    return res.status(statusCode).json({ 
      success: false, 
      message: err.message || err.toString() 
    });
  }
}
