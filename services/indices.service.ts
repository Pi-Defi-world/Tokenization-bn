import env from '../config/env';
import { getTermPremium } from '../config/savings';
import { LendingPool } from '../models/LendingPool';

export type IndexContext = {
  poolId?: string;
  asset?: { code: string; issuer: string };
  termDays?: number;
};

/**
 * Single place to read "index" values (base rate, funding cost, utilization, term premium).
 * Used by rate algorithms so products don't read raw env.
 */
export class IndicesService {
  async getIndex(id: string, context?: IndexContext): Promise<number> {
    switch (id) {
      case 'baseRate':
        return env.SAVINGS_BASE_RATE;
      case 'fundingCost':
        return this.getFundingCost();
      case 'utilization':
        if (!context?.poolId) throw new Error('getIndex(utilization) requires context.poolId');
        return this.getUtilization(context.poolId);
      case 'termPremium':
        if (context?.termDays == null) throw new Error('getIndex(termPremium) requires context.termDays');
        return getTermPremium(context.termDays);
      case 'volatility':
        if (!context?.asset) return 0;
        return this.getVolatility(context.asset);
      default:
        throw new Error(`Unknown index: ${id}`);
    }
  }

  private getFundingCost(): number {
    return env.SAVINGS_BASE_RATE;
  }

  private async getUtilization(poolId: string): Promise<number> {
    const pool = await LendingPool.findById(poolId).lean().exec();
    if (!pool) return 0;
    const supply = parseFloat((pool as any).totalSupply) || 0;
    const borrow = parseFloat((pool as any).totalBorrow) || 0;
    if (supply <= 0) return 0;
    return Math.min(1, borrow / supply);
  }

  private getVolatility(_asset: { code: string; issuer: string }): number {
    return 0;
  }
}

const indicesService = new IndicesService();
export default indicesService;
