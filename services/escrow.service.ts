import * as StellarSdk from '@stellar/stellar-sdk';
import { server } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';

/**
 * Creates a new Stellar account for escrow, funds it with minimal XLM from platform, and returns keypair.
 * Caller must store escrowPublicKey on Launch and use escrowSecret only once for LP deposit then lock.
 */
export async function createEscrowAccount(): Promise<{ publicKey: string; secretKey: string }> {
  const keypair = StellarSdk.Keypair.random();
  const publicKey = keypair.publicKey();
  const secretKey = keypair.secret();

  const minBalance = 2; // 2 XLM min for account + 1 for trustline etc
  const funderSecret = env.PLATFORM_ISSUER_SECRET;
  if (funderSecret) {
    const funder = StellarSdk.Keypair.fromSecret(funderSecret);
    const account = await server.loadAccount(funder.publicKey());
    const baseFee = await server.fetchBaseFee();
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: baseFee.toString(),
      networkPassphrase: env.NETWORK,
    })
      .addOperation(
        StellarSdk.Operation.createAccount({
          destination: publicKey,
          startingBalance: String(minBalance),
        })
      )
      .setTimeout(60)
      .build();
    tx.sign(funder);
    await server.submitTransaction(tx);
    logger.info(`Escrow account created and funded: ${publicKey}`);
  } else {
    logger.warn('PLATFORM_ISSUER_SECRET not set; escrow account not funded. Use friendbot or fund manually.');
  }

  return { publicKey, secretKey };
}

/**
 * Permanently lock the escrow account by setting master key weight to 0.
 * Irreversible: no further transactions can be signed by this account.
 */
export async function lockEscrowAccount(escrowSecret: string): Promise<void> {
  const keypair = StellarSdk.Keypair.fromSecret(escrowSecret);
  const account = await server.loadAccount(keypair.publicKey());
  const baseFee = await server.fetchBaseFee();
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: baseFee.toString(),
    networkPassphrase: env.NETWORK,
  })
    .addOperation(
      StellarSdk.Operation.setOptions({
        masterWeight: 0,
      })
    )
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  await server.submitTransaction(tx);
  logger.info(`Escrow account permanently locked: ${keypair.publicKey()}`);
}
