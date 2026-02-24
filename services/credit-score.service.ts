import { CreditScore } from '../models/CreditScore';
import { BorrowPosition } from '../models/BorrowPosition';
import { SupplyPosition } from '../models/SupplyPosition';

/** Minimum credit score (0-100) to be allowed to borrow. Below this, user cannot borrow. */
export const MIN_CREDIT_SCORE_TO_BORROW = 19;

/** Starting score for new users. */
export const CREDIT_SCORE_START = 50;

/** Points lost per default (liquidation). One default: 50 - 25 = 25; two: 0; below 19 cannot borrow. */
export const CREDIT_DEFAULT_PENALTY = 25;

/** Points gained per loan fully repaid. */
export const CREDIT_REPAID_BONUS = 5;

/** Score >= this and has history → max borrow term (e.g. 5 years). */
export const CREDIT_SCORE_MAX_TERM = 98;

/**
 * Rate discount (in percentage points) by credit score.
 * Example: 90+ => -3%, 80+ => -2%, 70+ => -1%. Otherwise 0.
 */
export function getCreditDiscountPercent(score: number): number {
  if (score >= 90) return 3;
  if (score >= 80) return 2;
  if (score >= 70) return 1;
  return 0;
}

/**
 * Max borrow term in days by credit score. Score >= 98 and has history (repaid or supply) → max term (5y).
 * Otherwise tiered by score.
 */
export function getMaxBorrowTermDays(score: number, hasHistory: boolean): number {
  if (score >= CREDIT_SCORE_MAX_TERM && hasHistory) return 1825; // 5 years
  if (score >= CREDIT_SCORE_MAX_TERM) return 365; // 1 year until history built
  if (score >= 80) return 730; // 2 years
  if (score >= 60) return 365;
  if (score >= 40) return 180;
  return 90;
}

/**
 * Effective yearly rate after discount: baseRate - discount (e.g. 15 - 2 = 13%).
 */
export function applyCreditDiscount(baseRateYearlyPercent: number, score: number): number {
  const discount = getCreditDiscountPercent(score);
  return Math.max(0, baseRateYearlyPercent - discount);
}

export class CreditScoreService {
  /**
   * Compute score 0-100 from behaviour: start 50, -25 per default (liquidated), +5 per repaid loan.
   * Below 19 cannot borrow. Acts as a real credit system.
   */
  async computeScoreFromBehaviour(userId: string): Promise<number> {
    const [defaultCount, repaidCount] = await Promise.all([
      BorrowPosition.countDocuments({ userId, liquidatedAt: { $ne: null } }).exec(),
      BorrowPosition.countDocuments({ userId, repaidAt: { $exists: true, $ne: null } }).exec(),
    ]);
    let score = CREDIT_SCORE_START - defaultCount * CREDIT_DEFAULT_PENALTY + repaidCount * CREDIT_REPAID_BONUS;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /** Whether user has "history" (at least one repaid loan or one supply position) for max-term eligibility. */
  async hasHistory(userId: string): Promise<boolean> {
    const [repaid, supply] = await Promise.all([
      BorrowPosition.countDocuments({ userId, repaidAt: { $exists: true, $ne: null } }).exec(),
      SupplyPosition.countDocuments({ userId }).exec(),
    ]);
    return repaid > 0 || supply > 0;
  }

  /** Returns { score, maxBorrowTermDays, hasHistory, canBorrow }. */
  async getScoreWithTerms(userId: string): Promise<{ score: number; maxBorrowTermDays: number; hasHistory: boolean; canBorrow: boolean; reason?: string }> {
    const score = await this.getScoreOrDefault(userId);
    const hasHistory = await this.hasHistory(userId);
    const maxBorrowTermDays = getMaxBorrowTermDays(score, hasHistory);
    const canBorrow = score >= MIN_CREDIT_SCORE_TO_BORROW;
    const reason = !canBorrow ? `Credit score ${score} is below minimum ${MIN_CREDIT_SCORE_TO_BORROW}` : undefined;
    return { score, maxBorrowTermDays, hasHistory, canBorrow, reason };
  }

  async getScore(userId: string): Promise<number | null> {
    const doc = await CreditScore.findOne({ userId }).lean().exec();
    if (doc && (doc as any).source === 'manual') return doc.score;
    const computed = await this.computeScoreFromBehaviour(userId);
    await CreditScore.findOneAndUpdate(
      { userId },
      { score: computed, source: 'computed' },
      { new: true, upsert: true }
    ).exec();
    return computed;
  }

  async setScore(userId: string, score: number): Promise<{ userId: string; score: number }> {
    if (score < 0 || score > 100) throw new Error('Credit score must be between 0 and 100');
    const doc = await CreditScore.findOneAndUpdate(
      { userId },
      { score, source: 'manual' },
      { new: true, upsert: true }
    ).exec();
    return { userId: doc.userId, score: doc.score };
  }

  async getScoreOrDefault(userId: string): Promise<number> {
    const score = await this.getScore(userId);
    return score ?? 50;
  }

  async canBorrow(userId: string): Promise<{ allowed: boolean; score: number; reason?: string }> {
    const score = await this.getScoreOrDefault(userId);
    if (score < MIN_CREDIT_SCORE_TO_BORROW) {
      return { allowed: false, score, reason: `Credit score ${score} is below minimum ${MIN_CREDIT_SCORE_TO_BORROW}` };
    }
    return { allowed: true, score };
  }
}
