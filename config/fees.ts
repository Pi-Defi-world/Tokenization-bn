/**
 * Platform fee applied to payouts: dividend payouts, savings interest, lending supply/borrow/liquidation.
 * 0.6% = 60 basis points.
 * All fee amounts are to be sent to the address in env PLATFORM_FEE_PUBLIC_KEY.
 */
export const PAYOUT_FEE_RATE = 0.006;

/**
 * Apply 0.6% fee: returns amount after fee (holder receives this).
 * feeAmount = amount * PAYOUT_FEE_RATE, netAmount = amount - feeAmount.
 */
export function applyPayoutFee(amount: string): { netAmount: string; feeAmount: string } {
  const a = parseFloat(amount);
  const feeAmount = (a * PAYOUT_FEE_RATE).toFixed(7);
  const netAmount = (a - parseFloat(feeAmount)).toFixed(7);
  return { netAmount, feeAmount };
}
