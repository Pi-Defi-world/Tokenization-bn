import { PoolService } from './liquidity-pools.service';
import env from '../config/env';
import { logger } from '../utils/logger';

const poolService = new PoolService();

function piAssetString(): string {
  if (env.PI_ASSET_CODE === 'native') return 'native';
  return `${env.PI_ASSET_CODE}:${env.PI_ASSET_ISSUER || ''}`;
}

function assetString(code: string, issuer: string): string {
  if (code === 'native') return 'native';
  return `${code}:${issuer}`;
}

/**
 * Returns price of 1 unit of the given asset in Pi (base unit).
 * Uses DEX pool reserves: price = piReserve / assetReserve when pool has both Pi and asset.
 */
export async function getPriceInPi(asset: { code: string; issuer: string }): Promise<string> {
  const pi = piAssetString();
  const assetStr = assetString(asset.code, asset.issuer);
  if (assetStr === pi) return '1';

  const { records } = await poolService.getLiquidityPools(100);
  const match = records.find((p: any) => {
    const reserves = (p.reserves || []).map((r: any) => r.asset);
    return reserves.includes(pi) && reserves.some((r: string) => r === assetStr || r.startsWith(asset.code + ':'));
  });
  if (!match) {
    logger.warn(`PriceService: no pool found for asset ${asset.code}, returning 0`);
    return '0';
  }
  const pool = await poolService.getLiquidityPoolById(match.id);
  const [resA, resB] = pool.reserves;
  const isPiFirst = resA.asset === pi || (resA.asset && resA.asset.startsWith(env.PI_ASSET_CODE + ':'));
  const piReserve = isPiFirst ? parseFloat(resA.amount) : parseFloat(resB.amount);
  const otherReserve = isPiFirst ? parseFloat(resB.amount) : parseFloat(resA.amount);
  if (otherReserve === 0) return '0';
  return (piReserve / otherReserve).toFixed(7);
}

/**
 * Get prices for multiple assets (e.g. for lending UI). Returns map of "code:issuer" -> price in Pi.
 */
export async function getPricesInPi(assets: { code: string; issuer: string }[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const pi = piAssetString();
  for (const a of assets) {
    const key = assetString(a.code, a.issuer);
    if (key === pi) {
      result[key] = '1';
      continue;
    }
    result[key] = await getPriceInPi(a);
  }
  return result;
}
