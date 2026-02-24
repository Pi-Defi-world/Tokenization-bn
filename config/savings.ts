/**
 * Savings product config: standard term options and term premium curve.
 * Used by indices service and savings rate algorithm.
 */

/** Standard term lengths in days: 40, 60, 90, 1y, 2y, 5y. */
export const TERM_DAYS = [40, 60, 90, 365, 730, 1825] as const;

/** Term premium (in percentage points) by term days. Longer lock = higher premium. */
const TERM_PREMIUM_MAP: Record<number, number> = {
  40: 0,
  60: 0.1,
  90: 0.25,
  365: 0.5,
  730: 1,
  1825: 2,
};

/**
 * Get term premium in percentage points for a given term (days).
 * Interpolates between known points; returns 0 for unknown terms.
 */
export function getTermPremium(termDays: number): number {
  if (TERM_PREMIUM_MAP[termDays] !== undefined) {
    return TERM_PREMIUM_MAP[termDays];
  }
  const sorted = [...Object.keys(TERM_PREMIUM_MAP)].map(Number).sort((a, b) => a - b);
  if (termDays <= sorted[0]) return TERM_PREMIUM_MAP[sorted[0]] ?? 0;
  if (termDays >= sorted[sorted.length - 1]) return TERM_PREMIUM_MAP[sorted[sorted.length - 1]] ?? 0;
  let lo = sorted[0], hi = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (termDays >= sorted[i] && termDays <= sorted[i + 1]) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }
  const t = (termDays - lo) / (hi - lo);
  return (TERM_PREMIUM_MAP[lo] ?? 0) + t * ((TERM_PREMIUM_MAP[hi] ?? 0) - (TERM_PREMIUM_MAP[lo] ?? 0));
}

/**
 * Compute savings APY for a term given base rate (e.g. from indices).
 * APY = baseRate + termPremium (both in %).
 */
export function getSavingsApy(termDays: number, baseRate: number): number {
  return baseRate + getTermPremium(termDays);
}
