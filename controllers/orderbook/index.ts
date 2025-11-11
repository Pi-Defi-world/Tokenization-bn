
import { Request, Response } from "express";
import { getAssetFromCodeIssuer } from "../../utils/asset";
import { orderBookService } from "../../services/orderbook.service";


export async function getOrderBookHandler(req: Request, res: Response) {
  try {
    const { base, counter } = req.query;
    if (!base || !counter) return res.status(400).json({ success: false, message: "base and counter are required" });

    const baseAsset = getAssetFromCodeIssuer(String(base));
    const counterAsset = getAssetFromCodeIssuer(String(counter));

    const book = await orderBookService.getOrderBook(baseAsset, counterAsset);
    return res.json({ success: true, book });
  } catch (err: any) {
    console.error("getOrderBookHandler", err);
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
    console.error("getOffersByAccountHandler", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}
