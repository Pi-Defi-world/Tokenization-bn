import { EngagementEvent } from '../models/EngagementEvent';
import { Participation } from '../models/Participation';
import { Launch } from '../models/Launch';
import type { EngagementTier } from '../models/Participation';
import { logger } from '../utils/logger';

/** Event types that contribute to engagement score. Optional weight for future use. */
const EVENT_WEIGHTS: Record<string, number> = {
  registration: 1,
  milestone: 2,
  referral: 1,
  daily_active: 1,
  custom: 1,
};

export class EngagementService {
  /**
   * Ingest an engagement event during the participation window.
   * Idempotency can be enforced by (launchId, userId, eventType, at) if needed.
   */
  async ingestEvent(
    launchId: string,
    userId: string,
    eventType: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    if (launch.status !== 'participation_open') {
      throw new Error('Engagement events only accepted when participation window is open');
    }

    await EngagementEvent.create({
      launchId,
      userId,
      eventType,
      payload: payload ?? {},
      at: new Date(),
    });
    logger.info(`Engagement event: launch=${launchId} user=${userId} type=${eventType}`);
  }

  /**
   * Compute engagement score for a user in a launch (sum of event weights).
   */
  async computeUserScore(launchId: string, userId: string): Promise<number> {
    const events = await EngagementEvent.find({ launchId, userId }).exec();
    let score = 0;
    for (const e of events) {
      score += EVENT_WEIGHTS[e.eventType] ?? EVENT_WEIGHTS.custom ?? 1;
    }
    return score;
  }

  /**
   * Snapshot engagement: compute score and rank for all participants, write to Participation.
   * Call when participation window closes (before or at transition to participation_closed).
   * Immutable snapshot for allocation.
   */
  async snapshotEngagement(launchId: string): Promise<void> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    if (launch.status !== 'participation_closed') {
      throw new Error('Snapshot only after participation window is closed');
    }

    const participations = await Participation.find({ launchId }).exec();
    const scores: { userId: string; score: number }[] = [];
    for (const p of participations) {
      const score = await this.computeUserScore(launchId, p.userId);
      scores.push({ userId: p.userId, score });
    }

    scores.sort((a, b) => b.score - a.score);
    const n = scores.length;
    const topCount = Math.ceil(n / 3);
    const midCount = Math.ceil(n / 3);
    const bottomCount = n - topCount - midCount;

    let rank = 0;
    for (const { userId, score } of scores) {
      rank++;
      const tier: EngagementTier =
        rank <= topCount ? 'top' : rank <= topCount + midCount ? 'mid' : 'bottom';
      await Participation.findOneAndUpdate(
        { launchId, userId },
        { $set: { engagementScore: score, engagementRank: rank, tier } },
        { new: true }
      ).exec();
    }

    logger.info(`Engagement snapshot: launch=${launchId} participants=${n}`);
  }
}
