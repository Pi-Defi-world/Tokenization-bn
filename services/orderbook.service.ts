
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
    return res.records.map((o: any) => ({
      id: o.id,
      selling: o.selling,
      buying: o.buying,
      amount: Number(o.amount),
      price: o.price,
      last_modified_ledger: o.last_modified_ledger,
    }));
  }
}

export const orderBookService = new OrderBookService();
