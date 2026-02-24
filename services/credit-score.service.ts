import { CreditScore } from '../models/CreditScore';

/** Minimum credit score to be allowed to borrow. */
export const MIN_CREDIT_SCORE_TO_BORROW = 30;

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
 * Effective yearly rate after discount: baseRate - discount (e.g. 15 - 2 = 13%).
 */
export function applyCreditDiscount(baseRateYearlyPercent: number, score: number): number {
  const discount = getCreditDiscountPercent(score);
  return Math.max(0, baseRateYearlyPercent - discount);
}

export class CreditScoreService {
  async getScore(userId: string): Promise<number | null> {
    const doc = await CreditScore.findOne({ userId }).lean().exec();
    return doc?.score ?? null;
  }

  async setScore(userId: string, score: number): Promise<{ userId: string; score: number }> {
    if (score < 0 || score > 100) throw new Error('Credit score must be between 0 and 100');
    const doc = await CreditScore.findOneAndUpdate(
      { userId },
      { score },
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
