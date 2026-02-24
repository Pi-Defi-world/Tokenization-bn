Here’s a way to structure everything so product values (rates, terms, limits, scores) come from **indices + algorithms** instead of ad‑hoc config.

# Products architecture

## Conclusion / executive summary

- **One custody pool:** All savings, lending supply, collateral, and repayments use `PLATFORM_CUSTODY_PUBLIC_KEY` (from `PLATFORM_ISSUER_SECRET`). Pools are logical (DB only).
- **Fund segmentation:** Lenders' funds are used only for borrowing. Savings funds are for AMM liquidity (and optional strategies). Reserve buffer (`RESERVE_BUFFER_RATIO`) keeps a fraction of supply un-lent.
- **Rates and limits** come from **indices + algorithms** (base rate, funding cost, utilization, term premium). At deposit/borrow we snapshot the computed value (e.g. `apyAtDeposit`) on the position.
- **Timestamps:** Positions use `depositedAt`; interest is displayed as it grows; withdraw at exact unlock time.
- **Onchain:** All value-moving flows are onchain. See [onchain-vs-db.md](onchain-vs-db.md).
- **Fees:** All fees go to `PLATFORM_FEE_PUBLIC_KEY` (config/fees.ts, config/env.ts). See also [fund-segmentation.md](fund-segmentation.md), [LENDING.md](LENDING.md), [treasury-amm.md](treasury-amm.md).

---

## 1. High-level idea

- **Indices** = time-series inputs (rates, risk-free proxy, volatility, utilization, etc.).
- **Algorithms** = pure functions that take indices + product/context and return **numbers** (APY, LTV, min score, max term, etc.).
- **Products** = definitions (asset, term buckets, risk tier) that **reference** which indices and which algorithm (and params) to use. No hardcoded “this product = 4%”; it’s “this product uses algorithm X with indices A, B”.

So: **indices → algorithms → product parameters → user-facing values.**

---

## 2. Indices you need (and where they come from)

Think of these as **named time series** your system (or oracles) maintain. Each has a **current value** and optionally history.

| Index | Meaning | Source (how to get it) | Used for |
|-------|--------|------------------------|----------|
| **Risk-free / base rate** | “Safe” yield (e.g. platform base or proxy) | Admin-set, or external API (e.g. central bank / Pi rate), or derived from your own “savings floor” | Base for savings and borrow rates |
| **Funding cost** | Cost to fund lending (e.g. average savings rate or wholesale rate) | Average of your savings product rates by term, or external | Lending supply/borrow rate base |
| **Pool utilization** | `totalBorrow / totalSupply` per pool | On-chain + DB (you already have `totalSupply`, `totalBorrow`) | Variable borrow/supply spread (utilization → rate) |
| **Asset volatility** (or risk tier) | Volatility or risk bucket of collateral asset | Historical price variance, or manual risk tier (e.g. “stable”, “volatile”) | Collateral factor (LTV), liquidation threshold |
| **Credit index** | Distribution of scores (e.g. median, percentiles) | From your own score population (e.g. median score, default rate by score band) | Calibrating min score, rate tiers |
| **Term premium** | Extra yield for locking longer | Curve: e.g. 40d=0, 90d=+0.5%, 1y=+1%, 5y=+2% (vs base) | Savings/borrow rate by term |
| **Platform default rate** | Historical default rate (e.g. by score band or pool) | From your DB (repaid vs defaulted) | Credit pricing, min score, reserves |

Best practice: **one service or module “Indices”** that exposes `get(indexId, [timestamp])` and is the only place that knows if a value is from DB, env, or an external API. Algorithms then depend only on “index names”, not on where the number came from.

---

**Implementation:** `services/indices.service.ts` exposes `getIndex(id, context?)`. Supported ids and sources: `baseRate` (env `SAVINGS_BASE_RATE` or `BASE_RATE`, default 2); `fundingCost` (same as baseRate); `utilization` (requires `context.poolId`, from LendingPool totalBorrow/totalSupply); `termPremium` (requires `context.termDays`, from `config/savings.ts` term curve); `volatility` (optional, context.asset). Term curve: 40→0, 60→0.1, 90→0.25, 365→0.5, 730→1, 1825→2 (%).

---

## 3. Algorithm layer (how indices turn into product values)

Algorithms are **pure functions**: same inputs ⇒ same outputs. They don’t write to DB; they only read indices and params and return numbers.

### 3.1 Savings rate (per term)

- **Inputs:** `baseRate` (index), `termDays`, optional `termPremium` (index or curve).
- **Output:** APY for that term.

Example (linear term premium):

- `savingsApy(termDays) = baseRate + termPremium(termDays)`  
- `termPremium(termDays)` from a **term structure**: e.g. 40d=0, 60d=0.1%, 90d=0.25%, 1y=0.5%, 2y=1%, 5y=2%.

So “product values” for savings are **fully algorithmic**: you only store `baseRate` (and maybe the curve) in indices; 40/60/90/1y/2y/5y come from the same formula.

### 3.2 Lending: supply rate

- **Inputs:** `utilization` (index per pool), `fundingCost` (index), margin.
- **Output:** Supply APY.

Example:

- `supplyRate = fundingCost + f(utilization)`  
- e.g. `f(u) = spreadLow when u < 0.8`, `spreadHigh when u >= 0.8` (kink model), or linear in `u`.

So supply rate is **systemic**: driven by utilization and funding cost, not a single env var.

### 3.3 Lending: borrow rate

- **Inputs:** Same utilization + funding cost, plus **credit tier** (from score).
- **Output:** Borrow APR/APY.

Example:

- `borrowRate(userScore) = baseBorrowRate(utilization) - creditDiscount(score)`  
- `baseBorrowRate` from utilization (and funding cost); `creditDiscount` from a **score → discount** table (e.g. 90+ ⇒ -3%, 80+ ⇒ -2%, …).  
- Optionally: **time** (e.g. fixed-term loans) with a term premium so longer tenor = higher rate.

So **interest** is algorithmic (indices + utilization + score); **time** can be “open-ended” or “term buckets” with a term curve; **amount** stays “collateral × LTV”.

### 3.4 Collateral factor (LTV) and liquidation

- **Inputs:** `collateralAsset` (or its **volatility / risk tier** index), optional **credit tier**.
- **Output:** Max LTV (e.g. 0.8 for “stable”, 0.6 for “volatile”).

Example:

- `maxLTV(asset) = baseLTV - volatilityPenalty(asset)`  
- Liquidation threshold = e.g. `maxLTV * 0.9` (when health factor drops below 1.0).

So **amount** (max borrow) is algorithmic: collateral value × **algorithmic LTV**, not a single magic number.

### 3.5 Credit score and “minimum 30”

- **Inputs:** Behaviour (repayment history, utilization, tenure, maybe on-chain activity).
- **Output:** Score 0–100.

Ways to make it algorithmic:

- **Rule-based:** start at 50; +N for each repaid loan; -M for late/default; +K for wallet age / number of successful txs. Clamp to 0–100.
- **Statistical:** logistic model on “default” (0/1) with features = score_band, amount, term, etc.; then map model output to a score or to “allow/deny” and a rate tier.
- **Minimum to borrow:** “30” becomes **policy**: e.g. “only allow if score ≥ P30 (30th percentile of active borrowers)” or “score ≥ 30” as a fixed floor. So the **threshold** can be index-based (percentile) or a single policy constant; the **score** itself is from the algorithm.

So **interest, time, amount** are all determined by indices + algorithms; the “30” is either a fixed policy or an index (e.g. percentile of the score distribution).

---

## 4. How to structure this in the system

### 4.1 Layering (financial + technical)

```
┌─────────────────────────────────────────────────────────────────┐
│  PRODUCT LAYER (SavingsProduct, LendingPool, etc.)               │
│  - References: asset, termBuckets, algorithmId, param overrides │
│  - No raw “apy” or “rate”; only “rateSource = algorithm + indices”│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ALGORITHM LAYER (pure functions)                                │
│  - getSavingsApy(termDays, indices)                              │
│  - getBorrowRate(utilization, score, indices)                     │
│  - getMaxLTV(asset, indices)                                     │
│  - getCreditScore(userId, behaviour) or getScoreTier(score)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  INDICES LAYER                                                   │
│  - getIndex(id): baseRate, fundingCost, utilization(poolId),     │
│    termPremium(termDays), volatility(asset), defaultRate, …      │
│  - Values from: DB, env, internal calc (e.g. utilization), API  │
└─────────────────────────────────────────────────────────────────┘
```

- **Indices:** single place that “gets” a number (from DB, config, or API). Can cache and version.
- **Algorithms:** only read indices + product/context; return rates, LTV, term premium, score.
- **Products:** “this savings product uses `savingsApy` with indices `[baseRate, termPremium]`”; “this pool uses `borrowRate(utilization, score)`”.

That’s the **systemic** part: no product “is 4%”; it “is computed by algorithm X from indices Y”.

### 4.2 Data model (conceptual)

- **Index definition:** `id`, `name`, `source` (enum: db | env | computed | api), `config` (e.g. poolId for utilization, asset for volatility), `currentValue`, `updatedAt`. Optional: history table for backtests.
- **Algorithm definition:** `id`, `name`, `inputIndices[]`, `inputParams` (e.g. curve coefficients), `version`. Code is the real “algorithm”; DB stores which algorithm and which indices a product uses.
- **Product:**
  - **Savings:** `asset`, `termOptions: [{ days, rateAlgorithmId, rateIndices[] }]` or one `rateAlgorithmId` + global term curve. At deposit, you run the algorithm **once** and store **snapshot** (termDays, apyAtDeposit) on the position.
  - **Lending:** `asset`, `supplyRateAlgorithmId`, `borrowRateAlgorithmId`, `collateralFactorAlgorithmId` (or per-asset), `utilizationIndexId` (e.g. poolId). So interest, time (if you add terms), and amount (max borrow = collateral × algorithmic LTV) all come from algorithms + indices.

**Timestamps and interest display:** Savings positions have `depositedAt` (exact deposit time) and optional `apyAtDeposit` (rate at lock). Interest is computed using `apyAtDeposit` or product.apy. API returns `accruedInterestSoFar` (0 until unlock, then full term interest), `projectedInterestAtUnlock`, and `depositedAt` so the UI can show profit growing. Products can define `termOptions` (e.g. 40, 60, 90, 365, 730, 1825 days) with optional fixed apy or algorithm-derived rate.

### 4.3 Credit score and “30”

- **Score:** Implement one **score algorithm** (rule-based or model) that takes **behaviour indices**: repayment history, utilization, tenure, defaults. Output 0–100. Store in `CreditScore` and optionally cache.
- **Minimum to borrow:** Either:
  - **Policy constant:** “min score = 30” (config/env), or  
  - **Index:** “min score = 30th percentile of active borrowers” (you’d maintain a small index “scorePercentile30” from your score distribution).  
So “how we get the 30” is: we define it as policy or as an index; the **score** itself comes from the algorithm.

---

## 5. Practical implementation order

1. **Indices service**  
   - Implement `getIndex(id)` with at least: `baseRate`, `fundingCost`, `utilization(poolId)`, `termPremium(termDays)` (e.g. from config/DB).  
   - Add **computed** indices where needed (e.g. utilization from `totalBorrow/totalSupply`).

2. **Term structure for savings**  
   - One curve: 40, 60, 90, 365, 730, 1825 days → term premium.  
   - `savingsApy(termDays) = baseRate + termPremium(termDays)`.  
   - Products expose “term options” and at deposit you snapshot the rate from this algorithm.

3. **Utilization-driven lending rates**  
   - `supplyRate = f(utilization)`, `borrowRate = g(utilization)` (e.g. linear or kink).  
   - Plug in `fundingCost` as base.  
   - Keep **credit score** as input to `borrowRate` (discount by score tier).  
   - So interest and (if you add it) time are algorithmic; amount remains collateral × LTV.

4. **LTV from volatility/risk**  
   - Add a small “risk tier” or “volatility” index per asset (or per pool).  
   - `maxLTV(asset) = baseLTV - penalty(asset)`.  
   - Use that in “max amount” and in liquidation threshold.

5. **Credit score algorithm**  
   - Replace “manual only” with a **rule-based** score: repayment history, defaults, tenure.  
   - Optionally later: replace with a small model fed by the same indices + behaviour.

6. **Config and versioning**  
   - Move constants (min score, base LTV, kink utilization) into **config/DB** as algorithm params.  
   - Optionally version algorithm params so you can backtest and roll back.

---

## 6. Summary

- **Systemic:** All product values (rates, terms, limits, scores) come from **indices + algorithms**, not scattered env vars or magic numbers.
- **Indices:** Base rate, funding cost, utilization, term premium, volatility/risk, (optionally) credit distribution and default rate.
- **Algorithms:** Savings APY by term; supply/borrow rate by utilization (and score); LTV by asset risk; credit score from behaviour.
- **Products:** Reference algorithm + indices; at contract/position creation you **snapshot** the computed values (e.g. APY at deposit, LTV at borrow) so the contract is clear and auditable.
- **Interest:** From indices (base, funding, utilization) + algorithm (term, score).  
- **Time:** From product term options (e.g. 40/60/90/1y/2y/5y) and optional term premium in the same algorithm.  
- **Amount:** From collateral value × algorithmic LTV.  
- **Credit “30”:** Policy threshold (or percentile index); the score itself from a dedicated score algorithm fed by behaviour/indices.

Tracing the codebase to determine what's onchain vs. in the DB and how deposited funds are used.
 




Here’s a concise picture of what’s onchain vs DB, what the funds are used for today, and how you could use them to generate yield.

---

## 1. What’s onchain vs what’s in the DB

### Single custody account

All of these flows use **one** Stellar account: `PLATFORM_CUSTODY_PUBLIC_KEY` (derived from `PLATFORM_ISSUER_SECRET`). There are no separate onchain “savings pool” or “lending pool” accounts; those exist only in the DB.

### Savings

| Step | Onchain | DB |
|------|--------|----|
| **Deposit** | Yes. User signs a **payment** from their wallet → custody. | Create/update **SavingsPosition**: `userId`, `productId`, `amount`, `unlockedAt`, `status: 'locked'`. |
| **Withdraw** | **No.** No automatic payment in the code. | Position → `status: 'withdrawn'`, `interestAccrued` set. API returns **`payoutInstructions`** (asset, amount, payToUserId). A separate process (treasury/ops or future automation) is expected to send that amount from custody to the user. |

So: **deposit is onchain; withdraw is DB + instructions only** — the actual payout is not implemented in the service.

### Lending

| Step | Onchain | DB |
|------|--------|----|
| **Supply** | Yes. User → **payment** to custody. | **SupplyPosition** (userId, poolId, amount). **LendingPool** `totalSupply` increased. |
| **Withdraw (supply)** | Yes. Custody → **payment** to user (signed with `PLATFORM_ISSUER_SECRET`). | SupplyPosition and pool `totalSupply` decreased. |
| **Borrow** | Yes. (1) User → **payment** of collateral to custody. (2) Custody → **payment** of borrowed asset to user. | **BorrowPosition** created; pool `totalBorrow` increased. |
| **Repay** | Yes. User → **payment** to custody. | BorrowPosition updated (principal/interest); pool `totalBorrow` decreased. |
| **Liquidate** | Not in the snippets seen; likely custody → liquidator, and possibly user. | BorrowPosition updated; pool balances adjusted. |

So for lending, **all movements of funds are onchain**; the DB keeps the ledger (who supplied what, who borrowed what, rates, health factors).

### Summary table

| Action | Onchain | DB |
|--------|--------|----|
| Savings deposit | ✅ User → custody | ✅ SavingsPosition |
| Savings withdraw | ❌ (instructions only) | ✅ status, interestAccrued |
| Lending supply | ✅ User → custody | ✅ SupplyPosition, pool.totalSupply |
| Lending supply withdraw | ✅ Custody → user | ✅ position, pool.totalSupply |
| Borrow (collateral + loan) | ✅ User → custody (collateral), custody → user (loan) | ✅ BorrowPosition, pool.totalBorrow |
| Repay | ✅ User → custody | ✅ BorrowPosition, pool |

---

## 2. What we’re using savings and lending for today

### Lending

- **Supply:** User funds go **onchain to the same custody account**. The DB tracks `totalSupply` and per-user `SupplyPosition`.
- **Borrow:** When a user borrows, the **custody account sends** the borrowed asset to that user. So the **same custody balance** is used to:
  - Hold supplied funds
  - Pay out borrowers
  - Receive collateral and repayments

So **lending supply is explicitly used to fund borrowers**. The “pool” is the custody balance plus DB state; interest paid by borrowers can fund interest to suppliers (and platform fee).

### Savings

- **Deposit:** User funds go **onchain to the same custody account**.
- There is **no code** that:
  - Moves savings into a “lending pool”
  - Invests savings in AMM pools
  - Allocates savings to any other use

So **savings deposits are not programmatically used for anything**; they sit in custody. Interest to savers is not currently funded by any automated deployment of those funds — it would have to come from other revenue or from logic you add (e.g. “savings = supply to lending” or “savings → AMM”).

---

## 3. What else we can use the funds for to make profit and pay interest

All of the below assume the **same custody wallet** holds:

- Savings deposits  
- Lending supply  
- Borrowers’ collateral  
- Repayments  

So “use” = how that combined balance is deployed (onchain or via strategy logic).

### A. Lending (already in place)

- **Use:** Custody balance is used to fund borrows.
- **Profit:** Borrowers pay interest; after paying supply interest and platform fee, the remainder is profit (or can fund savings interest).
- **Gap:** Savings are not yet **allocated** to this. Conceptually you could treat “savings” as a share of the same pool (see below).

### B. Use savings as lending supply (unify the balance sheet)

- **Idea:** Don’t treat savings as a separate pile. When a user “saves,” you:
  - Onchain: same as now (user → custody).
  - DB: create a **SavingsPosition** (or equivalent) with term and rate, and **also** treat that amount as part of the **lending pool’s** deployable balance (e.g. increase a “totalSavings” or “totalSupply” that includes savings).
- **Use:** That combined custody balance is used to fund borrowers (as today).
- **Profit:** Borrower interest minus supply/savings interest and fees. So **savings interest is paid from lending margin**.
- **Implementation:** One custody pool; two DB views (savings positions vs supply positions) and possibly different liquidity rules (e.g. savings locked until term, supply withdrawable).

### C. Deploy into AMM / liquidity pools

- **Use:** Send part of custody balance to **AMM pools** (e.g. Pi/XLM, Pi/stable) as liquidity.
- **Profit:** Swap fees + any incentive tokens.
- **Risk:** Impermanent loss; smart contract risk.
- **Implementation:** A “treasury” or “strategy” service that builds and submits Stellar (or protocol) txs to add/remove liquidity; DB tracks “allocated to pool X” so you know how much is in lending vs AMM.

### D. Use collateral in other protocols

- **Use:** If the chain or a wrapper allows, use custody-held collateral in other DeFi (lending, staking).
- **Profit:** Interest or staking yield from those protocols.
- **Implementation:** Depends on chain/ecosystem; would be additional onchain txs and accounting in DB.

### E. Treasury / strategic allocation

- **Use:** Part of custody balance is “reserve”; part is deployed (lending, AMM, or off-chain).
- **Profit:** Spread between cost of funds (savings + supply rates) and return on deployed capital.
- **Implementation:** DB and policies for “allocated to lending / AMM / reserve”; optional onchain separation (e.g. multiple custody keys per strategy) for clarity.

### F. Explicit “savings → lending” with term matching

- **Use:** Savings deposits are **the** source of funding for a dedicated lending book (or a slice of the same book): e.g. “90-day savings fund 90-day loans.”
- **Profit:** Lending margin (borrow rate − savings rate) after fees.
- **Implementation:** Same custody; in DB you link “this savings product’s balance” to “this pool’s supply” and run interest and liquidity per term bucket.

---

## 4. End-to-end picture

- **Onchain:** One custody account receives deposits (savings + supply), holds collateral, sends borrows and supply-withdrawals, receives repayments. Savings **withdraw** is not yet onchain (only instructions).
- **DB:** Tracks positions (savings, supply, borrow), pool totals, rates, and who is owed what. No separate “pool” wallet onchain.
- **Current use of funds:** Lending supply is used to fund borrowers. Savings are not yet used for anything automated.
- **Ways to make profit and pay interest:**  
  - Use the **same** custody pool for both savings and lending (savings = funding source for borrowers; interest from lending pays savers).  
  - Add **AMM liquidity** or other deployments (with risk controls).  
  - Optionally **term-matching** and **treasury allocation** in DB so you know exactly what is “savings,” “supply,” “in AMM,” “reserve.”

If you want, the next step can be a short design for “savings = lending supply” (one custody, one balance sheet, DB and interest flow) and what to change so savings withdraw is also onchain (custody → user payment) like lending supply withdraw.






we need to move the leftovers onchain (e.g savings withdrawals etc)  and also 
we need to segment all funds and use timestamps on all the products, we dont just withdraw on a day,wehave a specific time,in this case the deposit time for savings

we need a system that lets user see their intrest, aka profit grows 

lenders money used for borrowing alone, savings money, used for liquidity supply for pools and done automated on chain with  
also we cannot refund a lender money using the sametime as the borrower, also how is it done in lending and borrowing protocols?

we need a system to track this doings and the profitability of it, we need a buffer to keep for emergency situations

we need a liqidating mechanism and we need to be sure that the intrest covers the actualcost and risk of doing that
move the liquidating on chain. currentlydefault base currency is the nativetoken to liquidate to using pools

we could also set aside savings funds to invest indifferent assets and trading pairs

in the future we are going to update to use different wallets for everything so we can give them different naming in the env but use the same wallet and replicate it 

where are all fees paid to?

Savings
Deposit: User funds to go onchain to the same custody account.
Move savings into a “lending pool”
Invests savings in AMM pools
Allocates savings to any other use

