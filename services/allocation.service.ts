import { Launch } from '../models/Launch';
import { Participation } from '../models/Participation';
import type { IParticipation } from '../models/Participation';
import { logger } from '../utils/logger';

function toFixed7(x: number): string {
  return x.toFixed(7);
}

/**
 * Design 1 allocation (PiRC):
 * - Single clearing price: p_list = C / T
 * - T_purchase_i = c_i / p_list (tokens for committed Pi)
 * - T_engage = 5% of T_available, distributed by tiers (top/mid/bottom) for discount
 * - LP is formed with (C, T); all Pi goes to LP, none to project.
 */
export class AllocationService {
  /**
   * Run Design 1 allocation. Call when launch status is participation_closed
   * and engagement has been snapshotted. Updates participations with
   * allocatedTokens, effectivePrice, tier (already set by engagement snapshot).
   * Sets launch.listingPrice = p_list.
   */
  async runDesign1(launchId: string): Promise<{
    totalC: string;
    pList: string;
    tEngage: string;
    participations: IParticipation[];
  }> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    if (launch.status !== 'participation_closed') {
      throw new Error('Allocation requires status participation_closed');
    }

    const participations = await Participation.find({ launchId }).sort({ engagementRank: 1 }).exec();
    const T = parseFloat(launch.T_available);
    if (T <= 0) throw new Error('T_available must be positive');

    let totalC = 0;
    for (const p of participations) {
      totalC += parseFloat(p.committedPi || '0');
    }

    if (totalC <= 0) {
      throw new Error('No committed Pi for allocation');
    }

    const pList = totalC / T;
    const pListStr = toFixed7(pList);

    // T_engage = 5% of T, distributed by tiers (top 1/3, mid 1/3, bottom 1/3)
    const tEngageTotal = 0.05 * T;
    const n = participations.length;
    const topCount = Math.ceil(n / 3);
    const midCount = Math.ceil(n / 3);
    const bottomCount = n - topCount - midCount;

    const topScoreSum = participations
      .filter((_, i) => i < topCount)
      .reduce((s, p) => s + p.engagementScore, 0);
    const midScoreSum = participations
      .filter((_, i) => i >= topCount && i < topCount + midCount)
      .reduce((s, p) => s + p.engagementScore, 0);
    const bottomScoreSum = participations
      .filter((_, i) => i >= topCount + midCount)
      .reduce((s, p) => s + p.engagementScore, 0);

    const tierShare = () => tEngageTotal / 3; // equal thirds per tier
    const topShare = tierShare();
    const midShare = tierShare();
    const bottomShare = tierShare();

    const updated: IParticipation[] = [];
    for (let i = 0; i < participations.length; i++) {
      const p = participations[i];
      const c = parseFloat(p.committedPi || '0');
      const tPurchase = c / pList;
      let tEngage = 0;
      if (i < topCount && topScoreSum > 0) {
        tEngage = (p.engagementScore / topScoreSum) * topShare;
      } else if (i < topCount + midCount && midScoreSum > 0) {
        tEngage = (p.engagementScore / midScoreSum) * midShare;
      } else if (bottomScoreSum > 0) {
        tEngage = (p.engagementScore / bottomScoreSum) * bottomShare;
      }
      const allocatedTokens = toFixed7(tPurchase + tEngage);
      p.allocatedTokens = allocatedTokens;
      p.effectivePrice = pListStr;
      await p.save();
      updated.push(p);
    }

    await Launch.findByIdAndUpdate(launchId, { $set: { listingPrice: pListStr } }).exec();

    logger.info(
      `Allocation Design 1: launch=${launchId} totalC=${totalC} p_list=${pListStr} T_engage=${toFixed7(tEngageTotal)}`
    );

    return {
      totalC: toFixed7(totalC),
      pList: pListStr,
      tEngage: toFixed7(tEngageTotal),
      participations: updated,
    };
  }
}
