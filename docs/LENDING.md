# Lending: fees, liquidation, validation, credit score

## 1. Where are the fees sent to?

All platform fees (0.6% on dividend payouts, savings interest, lending supply/withdraw/borrow origination, and liquidation rewards) are **sent to the Stellar public key** configured in env:

- **`PLATFORM_FEE_PUBLIC_KEY`** – Stellar account that receives fee amounts.

If unset, the backend still computes and returns `feeAmount` in API responses; the actual transfer to this address must be done by your custody/treasury (e.g. batch payouts to `PLATFORM_FEE_PUBLIC_KEY`). You can also read the intended destination via:

- **`GET /lending/fee-destination`** – returns `{ platformFeePublicKey }`.

---

## 2. How do we liquidate people that owe?

Liquidation is **permissionless**: anyone can trigger it when a borrow position becomes unhealthy.

- **When:** A position can be liquidated when **health factor &lt; 1.0** (collateral value × LTV &lt; debt value). Interest accrues **monthly** (see below), so as debt grows or collateral value drops, health factor can fall below 1.

- **Who:** Any user (liquidator) who repays part or all of the debt on behalf of the borrower.

- **How:**
  1. Liquidator calls **`POST /lending/positions/:borrowPositionId/liquidate`** with body `{ repayAmount, userId }` (userId = liquidator).
  2. Backend checks health factor &lt; 1, then:
     - Decreases the borrower’s debt by `repayAmount`.
     - Gives the liquidator **collateral** at a **5% bonus** (minus 0.6% platform fee on that collateral payout).
  3. The **actual on-chain transfers** (liquidator sends borrowed asset to the pool/treasury; pool/treasury sends collateral to liquidator) are done by your system using your custody or by the liquidator’s client. The API only updates balances and records the liquidation; it does not hold keys or submit Stellar transactions.

- **Result:** Borrower’s position is updated (less debt, less collateral); if debt reaches zero, the position is marked liquidated. Liquidator receives `collateralReward` (net of 0.6% fee) in the response for your system to pay out.

---

## Borrow types and rates (env)

Rates are **yearly**; interest accrues **monthly** (yearly rate / 12).

| Type           | Env variable                     | Default (yearly) |
|----------------|-----------------------------------|------------------|
| Small amount   | `BORROW_RATE_SMALL_YEARLY`        | 15%              |
| Big business   | `BORROW_RATE_BIG_BUSINESS_YEARLY` | 12%              |

- **Small vs big:** Compare `borrowAmount` (in borrowed asset units) to **`BORROW_THRESHOLD_SMALL_MAX`** (default `"10000"`).  
  `borrowAmount <= threshold` → small (15%); `borrowAmount > threshold` → big business (12%).

---

## Validation and credit score

- **Validation:** Before opening a borrow, the backend checks:
  - Pool exists and is active.
  - **Credit score ≥ 30** (configurable via `MIN_CREDIT_SCORE_TO_BORROW` in `credit-score.service.ts`).
  - Collateral asset allowed and LTV satisfied.
  - Pool has enough liquidity.

- **Credit score (0–100):**
  - **`GET /lending/credit-score?userId=...`** – returns `score`, `canBorrow`, and optional `reason`.
  - **`POST /lending/credit-score`** – body `{ userId, score }` to set/update score (e.g. from your own scoring logic or admin).

- **Rate discount by score:** Applied on top of the env-based rate (small or big business):
  - Score ≥ 90 → **−3%** yearly.
  - Score ≥ 80 → **−2%** yearly.
  - Score ≥ 70 → **−1%** yearly.

Example: small amount 15%, score 85 → effective **13%** yearly (15 − 2), and monthly interest = 13/12 %.
