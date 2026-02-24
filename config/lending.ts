import env from './env';

export type BorrowType = 'small' | 'big_business';

/**
 * Yearly rate in % for each borrow type (from env).
 * Small amount = 15%, big business = 12%.
 */
export function getBorrowRateYearly(borrowType: BorrowType): number {
  return borrowType === 'small' ? env.BORROW_RATE_SMALL_YEARLY : env.BORROW_RATE_BIG_BUSINESS_YEARLY;
}

/**
 * Monthly rate = yearly / 12 (as decimal, e.g. 0.0125 for 15% yearly).
 */
export function getBorrowRateMonthly(borrowType: BorrowType): number {
  return getBorrowRateYearly(borrowType) / 100 / 12;
}

/**
 * Classify borrow as small or big business by comparing borrow amount to threshold.
 * Threshold is in the same units as borrowAmount (asset units).
 */
export function getBorrowType(borrowAmount: string): BorrowType {
  const amount = parseFloat(borrowAmount);
  const threshold = parseFloat(env.BORROW_THRESHOLD_SMALL_MAX);
  return amount <= threshold ? 'small' : 'big_business';
}

/** Platform fee destination: all fees are sent to this Stellar public key. */
export function getPlatformFeePublicKey(): string {
  return env.PLATFORM_FEE_PUBLIC_KEY || '';
}
