# Onchain vs DB: product actions

All value-moving flows use a single custody account (`PLATFORM_CUSTODY_PUBLIC_KEY`). The DB holds the ledger (positions, pool totals, timestamps).

| Action | Onchain | DB updates | Custody role |
|--------|---------|------------|--------------|
| Savings deposit | Yes | Create SavingsPosition (amount, depositedAt, unlockedAt, apyAtDeposit) | Destination of user payment |
| Savings withdraw | Yes | Position → status withdrawn, interestAccrued | Signs payment to user (principal + interest) |
| Lending supply | Yes | SupplyPosition, LendingPool.totalSupply | Destination of user payment |
| Lending supply withdraw | Yes | SupplyPosition, pool.totalSupply | Signs payment to user |
| Borrow (collateral + loan) | Yes | BorrowPosition, pool.totalBorrow | Receives collateral; signs payment of borrowed asset to user |
| Repay | Yes | BorrowPosition, pool.totalBorrow | Destination of user payment |
| Liquidation | Yes | BorrowPosition, pool | Liquidator repays to custody (tx1); custody pays collateral to liquidator (tx2) |
| Launch commit | Yes | Participation.committedPi | Destination of user Pi payment |

Savings withdraw is implemented onchain: custody sends principal + interest to the user's wallet; response includes `transactionHash`.
