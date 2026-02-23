# Branch structure

This repo has three main branches. **passkey** was developed ahead of **main**; **PIRC** adds PiRC/Launchpad features on top.

## Branches

| Branch   | Description |
|----------|-------------|
| **main** | Primary branch. Updated to include all work from **passkey** (merge commit). Use this as the base for general development. |
| **passkey** | Auth, wallet, and platform features (passkey, create-wallet, send, transactions, etc.). Was ~100 commits ahead of main; now merged into main. |
| **PIRC**   | **main** + PiRC 1.0: Launchpad, Dividends, Savings, Lending, dashboard updates, DB retry, User sparse unique `public_key`. |

## Relationship

- **main** = history up to original main + **merge of passkey** (so main has all passkey work).
- **PIRC** = **main** + 3 commits (Dashboard/PiRC 1.0, then fixes like db retry and User model).

For PiRC/Launchpad work, use **PIRC**. For other work, use **main** (which already includes passkey).

## Notes

- **origin/main** and **origin/passkey** on the remote may be behind local **main** after the merge. Push with care: `git push origin main` updates remote main to include passkey.
- **PIRC** has diverged from **origin/PIRC** (local PIRC was rebased onto the new main). To update remote: `git push origin PIRC --force-with-lease`.
