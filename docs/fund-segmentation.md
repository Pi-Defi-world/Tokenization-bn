# Fund segmentation

## Single custody account

All product flows use **one** Stellar account: `PLATFORM_CUSTODY_PUBLIC_KEY` (derived from `PLATFORM_ISSUER_SECRET`). There are no separate onchain "savings pool" or "lending pool" wallets; pools are logical (DB only).

## Lenders' funds → borrowing only

Lending supply is used **only** to fund borrowers. The pool's `totalSupply` and `totalBorrow` track this. Withdrawals (supply withdraw) are allowed only up to **available liquidity**:

- **Available** = `totalSupply - totalBorrow - reserve`
- **Reserve** = `totalSupply * RESERVE_BUFFER_RATIO` (env, e.g. 0.05 = 5%)

So lender money is never refunded from the "same moment" as a borrower in the sense that we never allow withdrawing more than what is not already lent out. The reserve buffer keeps a fraction of supply un-lent for emergencies.

## Savings funds

Savings deposits go to the same custody account. In the target model, savings funds are used for **AMM liquidity** (and optionally other strategies). Liquidity rule: savings withdrawals require the custody balance to cover principal + interest (and, if savings are allocated to AMM, sufficient liquid balance or a prior AMM withdrawal).

## Reserve buffer

- **Config:** `RESERVE_BUFFER_RATIO` in env (0–1). Default 0 (no buffer).
- **Supply withdraw:** `amount <= totalSupply - totalBorrow - reserve`.
- **Borrow:** `totalBorrow + newBorrow <= totalSupply - reserve`.

This ensures we do not lend out 100% of supply and keeps a buffer for withdrawals and stress.

## Allocation tracking (optional)

To report or enforce segmentation, total savings can be derived as the sum of `amount` over `SavingsPosition` with `status: 'locked'` (see `SavingsService.getTotalSavings()`). Optional: a `TreasuryAllocation` collection (type: lending | amm, poolId, amount, asset) to track what is deployed where. See [treasury-amm.md](treasury-amm.md) for savings → AMM design.
