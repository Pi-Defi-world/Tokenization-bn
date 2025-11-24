import { server } from '../config/stellar';
import { logger } from '../utils/logger';
import env from '../config/env';
import { horizonQueue } from '../utils/horizon-queue';
import { getAsset } from '../config/stellar';
import * as StellarSdk from '@stellar/stellar-sdk';

export interface TradeAggregationParams {
  baseAssetType: string;
  baseAssetCode?: string;
  baseAssetIssuer?: string;
  counterAssetType: string;
  counterAssetCode?: string;
  counterAssetIssuer?: string;
  startTime?: string; // ISO 8601 timestamp
  endTime?: string; // ISO 8601 timestamp
  resolution?: number; // Resolution in seconds (e.g., 300 for 5 minutes, 3600 for 1 hour)
  offset?: number; // Offset in seconds
  limit?: number;
}

export interface TradeParams {
  baseAssetType: string;
  baseAssetCode?: string;
  baseAssetIssuer?: string;
  counterAssetType: string;
  counterAssetCode?: string;
  counterAssetIssuer?: string;
  cursor?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

export interface TradeAggregation {
  timestamp: string;
  trade_count: number;
  base_volume: string;
  counter_volume: string;
  avg: string; // Average price
  high: string; // Highest price
  low: string; // Lowest price
  open: string; // Opening price
  close: string; // Closing price
}

export interface Trade {
  id: string;
  paging_token: string;
  ledger_close_time: string;
  offer_id: string;
  base_account: string;
  base_amount: string;
  base_asset_type: string;
  base_asset_code?: string;
  base_asset_issuer?: string;
  counter_account: string;
  counter_amount: string;
  counter_asset_type: string;
  counter_asset_code?: string;
  counter_asset_issuer?: string;
  base_is_seller: boolean;
  price: {
    n: number;
    d: number;
  };
}

export class TradeAnalyticsService {
  /**
   * Get trade aggregations (OHLCV data) for price charts
   */
  public async getTradeAggregations(params: TradeAggregationParams) {
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
        resolution = 3600, // Default: 1 hour
        offset = 0,
        limit = 200,
      } = params;

      // Build query parameters
      const queryParams: any = {
        base_asset_type: baseAssetType,
        counter_asset_type: counterAssetType,
        resolution: resolution.toString(),
        offset: offset.toString(),
        limit: limit.toString(),
      };

      if (baseAssetCode) queryParams.base_asset_code = baseAssetCode;
      if (baseAssetIssuer) queryParams.base_asset_issuer = baseAssetIssuer;
      if (counterAssetCode) queryParams.counter_asset_code = counterAssetCode;
      if (counterAssetIssuer) queryParams.counter_asset_issuer = counterAssetIssuer;
      if (startTime) queryParams.start_time = startTime;
      if (endTime) queryParams.end_time = endTime;

      // Build URL
      const horizonUrl = env.HORIZON_URL;
      const queryString = new URLSearchParams(queryParams).toString();
      const url = `${horizonUrl}/trade_aggregations?${queryString}`;

      logger.info(`🔹 Fetching trade aggregations: ${baseAssetCode || 'native'}/${counterAssetCode || 'native'}`);

      // Use horizon queue for rate-limited requests
      const response = await horizonQueue.get<any>(url, { timeout: 15000 }, 0);
      
      if (response && typeof response === 'object' && 'status' in response && 'data' in response) {
        const httpResponse = response as { status: number; data?: any };
        if (httpResponse.status === 200 && httpResponse.data?._embedded?.records) {
          const aggregations = httpResponse.data._embedded.records as TradeAggregation[];
          logger.info(`✅ Fetched ${aggregations.length} trade aggregations`);
          return {
            data: aggregations,
            pagination: {
              limit,
              hasMore: aggregations.length === limit,
            },
          };
        }
      }

      return {
        data: [],
        pagination: {
          limit,
          hasMore: false,
        },
      };
    } catch (error: any) {
      logger.error(`❌ Error fetching trade aggregations:`, error);
      throw error;
    }
  }

  /**
   * Get recent trades for a trading pair
   */
  public async getTrades(params: TradeParams) {
    try {
      const {
        baseAssetType,
        baseAssetCode,
        baseAssetIssuer,
        counterAssetType,
        counterAssetCode,
        counterAssetIssuer,
        cursor,
        limit = 50,
        order = 'desc',
      } = params;

      // Build query parameters
      const queryParams: any = {
        base_asset_type: baseAssetType,
        counter_asset_type: counterAssetType,
        limit: limit.toString(),
        order: order,
      };

      if (baseAssetCode) queryParams.base_asset_code = baseAssetCode;
      if (baseAssetIssuer) queryParams.base_asset_issuer = baseAssetIssuer;
      if (counterAssetCode) queryParams.counter_asset_code = counterAssetCode;
      if (counterAssetIssuer) queryParams.counter_asset_issuer = counterAssetIssuer;
      if (cursor) queryParams.cursor = cursor;

      // Build URL
      const horizonUrl = env.HORIZON_URL;
      const queryString = new URLSearchParams(queryParams).toString();
      const url = `${horizonUrl}/trades?${queryString}`;

      logger.info(`🔹 Fetching trades: ${baseAssetCode || 'native'}/${counterAssetCode || 'native'}`);

      // Use horizon queue for rate-limited requests
      const response = await horizonQueue.get<any>(url, { timeout: 15000 }, 0);
      
      if (response && typeof response === 'object' && 'status' in response && 'data' in response) {
        const httpResponse = response as { status: number; data?: any };
        if (httpResponse.status === 200 && httpResponse.data?._embedded?.records) {
          const trades = httpResponse.data._embedded.records as Trade[];
          const nextCursor = trades.length > 0 ? trades[trades.length - 1].paging_token : undefined;
          
          logger.info(`✅ Fetched ${trades.length} trades`);
          return {
            data: trades,
            pagination: {
              limit,
              nextCursor,
              hasMore: trades.length === limit && nextCursor !== undefined,
              order,
            },
          };
        }
      }

      return {
        data: [],
        pagination: {
          limit,
          nextCursor: undefined,
          hasMore: false,
          order,
        },
      };
    } catch (error: any) {
      logger.error(`❌ Error fetching trades:`, error);
      throw error;
    }
  }

  /**
   * Get price statistics for a trading pair
   */
  public async getPriceStats(
    baseAsset: { code: string; issuer?: string },
    counterAsset: { code: string; issuer?: string },
    period: '24h' | '7d' | '30d' = '24h'
  ) {
    try {
      const now = new Date();
      const startTime = new Date();
      
      switch (period) {
        case '24h':
          startTime.setHours(startTime.getHours() - 24);
          break;
        case '7d':
          startTime.setDate(startTime.getDate() - 7);
          break;
        case '30d':
          startTime.setDate(startTime.getDate() - 30);
          break;
      }

      const baseAssetType = baseAsset.code === 'native' ? 'native' : 'credit_alphanum4';
      const counterAssetType = counterAsset.code === 'native' ? 'native' : 'credit_alphanum4';

      const aggregations = await this.getTradeAggregations({
        baseAssetType,
        baseAssetCode: baseAsset.code === 'native' ? undefined : baseAsset.code,
        baseAssetIssuer: baseAsset.issuer,
        counterAssetType,
        counterAssetCode: counterAsset.code === 'native' ? undefined : counterAsset.code,
        counterAssetIssuer: counterAsset.issuer,
        startTime: startTime.toISOString(),
        endTime: now.toISOString(),
        resolution: period === '24h' ? 3600 : period === '7d' ? 86400 : 86400, // 1h for 24h, 1d for 7d/30d
        limit: 200,
      });

      if (aggregations.data.length === 0) {
        return {
          period,
          price: null,
          change24h: null,
          high24h: null,
          low24h: null,
          volume24h: null,
        };
      }

      const sorted = aggregations.data.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const latest = sorted[sorted.length - 1];
      const oldest = sorted[0];

      const currentPrice = parseFloat(latest.close);
      const oldPrice = parseFloat(oldest.open);
      const change24h = oldPrice > 0 ? ((currentPrice - oldPrice) / oldPrice) * 100 : 0;

      const prices = sorted.map(a => parseFloat(a.close));
      const high24h = Math.max(...prices);
      const low24h = Math.min(...prices);

      const totalVolume = sorted.reduce((sum, a) => sum + parseFloat(a.counter_volume), 0);

      return {
        period,
        price: currentPrice,
        change24h: change24h,
        high24h: high24h,
        low24h: low24h,
        volume24h: totalVolume,
        tradeCount: sorted.reduce((sum, a) => sum + a.trade_count, 0),
      };
    } catch (error: any) {
      logger.error(`❌ Error fetching price stats:`, error);
      throw error;
    }
  }
}

export const tradeAnalyticsService = new TradeAnalyticsService();

