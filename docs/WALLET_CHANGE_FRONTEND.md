# Wallet change / new wallet – frontend integration

This document describes what the **frontend must do** to support **changing the user’s wallet address** and **setting up a new wallet**, including the required **warning** and confirmation flow.

---

## Backend behaviour (summary)

- **`POST /create-wallet`**  
  Creates a new wallet and links it to the authenticated user. If the user already had a wallet, the old one is **replaced** (old `public_key` is cleared). Response includes `replacedPreviousWallet`, `previousPublicKey`, and `warning` when a wallet was replaced.

- **`POST /change-wallet`**  
  Replaces the user’s **existing** wallet with a new one. Requires the user to have a wallet already and requires explicit confirmation in the body (see below). Returns the same response shape as create-wallet, with `replacedPreviousWallet: true` and a `warning` message.

---

## What the frontend MUST do

### 1. Decide which endpoint to call

- **First-time setup (user has no wallet)**  
  - Call **`POST /create-wallet`** (no body required).  
  - Optionally show a short notice that a new wallet is being created.

- **Changing / replacing an existing wallet**  
  - Call **`POST /change-wallet`** with body:  
    `{ "confirmReplace": true }`  
  - **Do not** call this until the user has seen the **warning** and confirmed (see below).

You can know if the user already has a wallet from the **auth/sign-in response** (user object with `public_key`) or from your stored user/profile state.

### 2. Show a warning before replacing a wallet

Before calling **`POST /change-wallet`**, the frontend **must**:

1. **Show a clear warning** to the user. Recommended text (or equivalent):

   > **Changing your wallet**
   >
   > Your current wallet will be replaced. The old wallet address will no longer be linked to this account.
   >
   > - Any funds in the old wallet are **not** automatically moved to the new one.
   > - You will need to save the **new** secret key securely; the old one will no longer be used for this account.
   >
   > Are you sure you want to replace your wallet?

2. **Require explicit user confirmation** (e.g. “I understand, replace my wallet” checkbox or button).  
3. **Only then** send `POST /change-wallet` with `{ "confirmReplace": true }`.

If you use **`POST /create-wallet`** when the user already has a wallet, the backend will still replace the wallet. So if your UI has a single “Create wallet” flow, you should **still show the same warning** when you know the user already has a `public_key` (e.g. from login response), and only proceed after confirmation.

### 3. Handle the API response

Both **create-wallet** and **change-wallet** return a response of this form:

```json
{
  "publicKey": "G...",
  "secret": "S...",
  "seedResult": { "success": true, "transactionHash": "...", "accountCreated": true, "amount": "2" },
  "replacedPreviousWallet": true,
  "previousPublicKey": "G...",
  "warning": "You have replaced your previous wallet. The old wallet address is no longer linked to this account. Any funds or data tied to the old address are not automatically transferred. Store your new secret key securely."
}
```

- **`replacedPreviousWallet`**  
  `true` if an existing wallet was replaced; `false` for a first-time wallet.

- **`previousPublicKey`**  
  Present when a wallet was replaced; the old wallet address. Can be shown in the UI (e.g. “Old address: …”) for clarity.

- **`warning`**  
  Present when a wallet was replaced. The frontend **should display this message** to the user after a successful replace (e.g. in a success screen or modal).

Frontend must:

- **Store the new `secret` securely** (e.g. encrypted local storage or passkey-backed flow as per your app’s design). Do not send the secret to the server again.
- **Update local user state** so that the app uses the new `publicKey` (e.g. refresh user/profile or replace `user.public_key` in state).
- **Refresh any wallet-dependent data** (balances, transactions, liquidity positions, etc.) using the new `publicKey`.
- If `warning` is present, **show it** to the user in the success step.

### 4. Error handling

- **`POST /change-wallet`**  
  - **400, `code: "CONFIRM_REQUIRED"`**  
    Request body missing or `confirmReplace` is not `true`. Frontend must not send the request until the user has confirmed; if you get this, show the warning again and require confirmation.  
  - **400, `code: "NO_WALLET_TO_REPLACE"`**  
    User has no wallet yet. Redirect or switch to “Create wallet” flow (`POST /create-wallet`).

- **`POST /create-wallet`**  
  - Usual 401/500 handling. On success, check `replacedPreviousWallet` and `warning` and behave as above.

### 5. Optional: “Change wallet” entry point

- In settings or account page, if the user **has** a wallet (`public_key` present), show an option like **“Change wallet”** or **“Set up a new wallet”**.
- That action should open the **warning + confirmation** flow; only after confirmation call **`POST /change-wallet`** with `{ "confirmReplace": true }`.
- If the user **does not** have a wallet, show **“Create wallet”** and call **`POST /create-wallet`** (with optional first-time message, but no “replace” warning).

---

## Checklist for frontend

- [ ] Use **`POST /change-wallet`** with `{ "confirmReplace": true }` only when the user already has a wallet and has confirmed the warning.
- [ ] Use **`POST /create-wallet`** for first-time wallet creation (no body required).
- [ ] **Always show the “replacing wallet” warning** before replacing an existing wallet and require explicit user confirmation.
- [ ] After a successful create/change, **display the `warning`** from the response when `replacedPreviousWallet` is true.
- [ ] **Store the new `secret`** securely and **update local user state** to the new `publicKey`.
- [ ] **Refresh** balances, transactions, and any other wallet-dependent data using the new `publicKey`.
- [ ] Handle **400** from change-wallet: `CONFIRM_REQUIRED` and `NO_WALLET_TO_REPLACE` as described above.

---

## API reference (change-wallet)

- **Endpoint:** `POST /account/change-wallet` (account routes are mounted under `/account`).
- **Auth:** Required (Bearer token).
- **Body:** `{ "confirmReplace": true }`.
- **Success (200):** Same as create-wallet: `publicKey`, `secret`, `seedResult`, `replacedPreviousWallet: true`, `previousPublicKey`, `warning`.
- **Errors:**  
  - 400 `CONFIRM_REQUIRED` – missing or invalid confirmation.  
  - 400 `NO_WALLET_TO_REPLACE` – user has no existing wallet.  
  - 401 – not authenticated.  
  - 500 – server error (e.g. seeding failed).
