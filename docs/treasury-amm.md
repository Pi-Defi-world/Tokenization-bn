# Treasury: savings → AMM allocation

## Goal

Savings funds (deposits in custody) can be allocated to **AMM liquidity** so yield from swap fees and incentives helps pay savings interest. Lenders' funds remain used only for borrowing; savings are the segment deployed to AMM.

## Design

- **Single custody:** All savings and lending use the same custody account. Allocation is tracked in DB (e.g. how much “savings” is in liquidity pool X).
- **Allocate:** A treasury/strategy process (or admin endpoint) calls existing liquidity-pools `addLiquidity` with **custody** as the source of funds. Before that, it checks that “available savings” (e.g. total locked savings minus reserved for imminent withdrawals) is sufficient. After a successful onchain add, record in DB: e.g. `TreasuryAllocation { type: 'amm', poolId, amount, asset, updatedAt }`.
- **Withdraw from savings:** When a user withdraws savings, we need custody to hold enough liquid balance (principal + interest). If part of savings is in AMM, we may need to **withdraw from AMM first** (remove liquidity) to get the asset back to custody, then pay the user. So: either (1) keep a **reserve** of savings that is never allocated to AMM, or (2) implement a flow that removes liquidity when needed to satisfy a withdrawal.
- **Reserve buffer:** Same idea as lending: do not allocate 100% of savings to AMM; keep a configurable fraction as liquid reserve.

## Implementation status

- **totalSavings:** Can be derived as the sum of `amount` over all `SavingsPosition` with `status: 'locked'`.
- **Allocation record:** Optional collection or table `TreasuryAllocation` to track how much is in AMM per pool.
- **allocateSavingsToAmm(poolId, amount):** Would load custody key, call liquidity-pools service to add liquidity from custody, then record allocation. Not yet implemented; custody would need to sign the add-liquidity tx.
- **Withdraw from savings:** Already onchain (custody → user). If allocations exist, ensure enough liquid balance (e.g. reserve) or add a step to remove liquidity when required.
