
import { server } from "../config/stellar";
import * as StellarSdk from "@stellar/stellar-sdk";

export class OrderBookService {
  async getOrderBook(selling: StellarSdk.Asset, buying: StellarSdk.Asset) {
    const book = await server.orderbook(selling, buying).call();
    return {
      bids: book.bids.map((b: any) => ({
        price: Number(b.price),
        amount: Number(b.amount),
        seller: b.seller,
      })),
      asks: book.asks.map((a: any) => ({
        price: Number(a.price),
        amount: Number(a.amount),
        seller: a.seller,
      })),
    };
  }

  async getOffersByAccount(accountId: string) {
    const res = await server.offers("accounts", accountId).call();
    return res.records.map((o: any) => {
      // Format selling asset
      let sellingStr: string;
      if (o.selling.asset_type === "native") {
        sellingStr = "native";
      } else {
        sellingStr = `${o.selling.asset_code}:${o.selling.asset_issuer}`;
      }

      // Format buying asset
      let buyingStr: string;
      if (o.buying.asset_type === "native") {
        buyingStr = "native";
      } else {
        buyingStr = `${o.buying.asset_code}:${o.buying.asset_issuer}`;
      }

      return {
        id: String(o.id),
        selling: sellingStr,
        buying: buyingStr,
        amount: String(o.amount),
        price: String(o.price),
        last_modified_ledger: o.last_modified_ledger,
      };
    });
  }
}

export const orderBookService = new OrderBookService();
