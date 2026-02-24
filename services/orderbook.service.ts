
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

  async getTrades(base: StellarSdk.Asset, counter: StellarSdk.Asset, limit: number = 20) {
    const res = await server.trades().forBaseAsset(base).forCounterAsset(counter).limit(limit).call();
    return res.records.map((t: any) => ({
      id: t.id,
      paging_token: t.paging_token,
      ledger_close_time: t.ledger_close_time,
      offer_id: String(t.offer_id),
      base_account: t.base_account,
      base_amount: t.base_amount,
      base_asset_type: t.base_asset_type,
      base_asset_code: t.base_asset_code || null,
      base_asset_issuer: t.base_asset_issuer || null,
      counter_account: t.counter_account,
      counter_amount: t.counter_amount,
      counter_asset_type: t.counter_asset_type,
      counter_asset_code: t.counter_asset_code || null,
      counter_asset_issuer: t.counter_asset_issuer || null,
      base_is_seller: t.base_is_seller,
      price: {
        n: Number(t.price.n),
        d: Number(t.price.d),
        price: Number(t.price.n) / Number(t.price.d),
      },
    }));
  }

  async getTradeAggregations(
    base: StellarSdk.Asset,
    counter: StellarSdk.Asset,
    resolution: number = 3600000, // 1 hour in milliseconds
    startTime?: Date,
    endTime?: Date,
    limit: number = 24
  ) {
    const builder = server
      .tradeAggregations()
      .forBaseAsset(base)
      .forCounterAsset(counter)
      .resolution(resolution)
      .limit(limit);

    if (startTime) {
      builder.startTime(startTime);
    }
    if (endTime) {
      builder.endTime(endTime);
    }

    const res = await builder.call();
    return res.records.map((agg: any) => ({
      timestamp: agg.timestamp,
      trade_count: Number(agg.trade_count),
      base_volume: agg.base_volume,
      counter_volume: agg.counter_volume,
      avg: agg.avg,
      high: agg.high,
      low: agg.low,
      open: agg.open,
      close: agg.close,
    }));
  }
}

export const orderBookService = new OrderBookService();
