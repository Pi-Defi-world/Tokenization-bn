import dotenv from 'dotenv';
import * as StellarSdk from '@stellar/stellar-sdk';

dotenv.config();

/** Derive platform custody public key from PLATFORM_ISSUER_SECRET so no extra env vars are needed. */
function getPlatformCustodyPublicKey(): string {
  const secret = process.env.PLATFORM_ISSUER_SECRET as string;
  if (!secret?.trim()) return '';
  try {
    return StellarSdk.Keypair.fromSecret(secret).publicKey();
  } catch {
    return '';
  }
}

const derivedPlatformPublicKey = getPlatformCustodyPublicKey();

const env = {
    HORIZON_URL: process.env.HORIZON_URL as string || 'https://api.testnet.minepi.com',
    NETWORK: process.env.NETWORK as string || 'Pi Testnet',
    PORT: process.env.PORT || 5000,
    BIP44_PATH: process.env.BIP44_PATH as string || "m/44'/314159'/0'",
    PLATFORM_ISSUER_SECRET: process.env.PLATFORM_ISSUER_SECRET as string,
    PI_API_KEY: process.env.PI_API_KEY as string,
    PLATFORM_API_URL: process.env.PLATFORM_API_URL as string,
    JWT_SECRET: process.env.JWT_SECRET as string,
    MONGO_URI: process.env.MONGO_URI as string,
    PI_TEST_USER_PUBLIC_KEY: process.env.PI_TEST_USER_PUBLIC_KEY as string,
    PI_TEST_USER_SECRET: process.env.PI_TEST_USER_SECRET as string,
    // Platform Fees
    PLATFORM_MINT_FEE: process.env.PLATFORM_MINT_FEE as string || "100",
    PLATFORM_POOL_FEE: process.env.PLATFORM_POOL_FEE as string || "10",
    PLATFORM_SWAP_FEE_AMOUNT: process.env.PLATFORM_SWAP_FEE_AMOUNT as string || "0.1", // Fixed fee in Pi (not percentage)
    // Horizon API Endpoints
    horizon: {
        // Official Stellar Horizon API
        stellar: {
            mainnet: process.env.STELLAR_HORIZON_MAINNET || 'https://horizon.stellar.org',
            testnet: process.env.STELLAR_HORIZON_TESTNET || 'https://horizon-testnet.stellar.org',
        },
        // Pi Network Horizon API
        pi: {
            mainnet: process.env.PI_HORIZON_MAINNET || 'https://api.mainnet.minepi.com',
            testnet: process.env.PI_HORIZON_TESTNET || 'https://api.testnet.minepi.com',
        },
    },
    /** Pi asset for launchpad LP: { code, issuer }. If code is 'native', issuer can be empty. */
    PI_ASSET_CODE: (process.env.PI_ASSET_CODE as string) || 'native',
    PI_ASSET_ISSUER: (process.env.PI_ASSET_ISSUER as string) || '',
    /** Lending: borrow rates (yearly %). Small amount = 15%, big business = 12%. */
    BORROW_RATE_SMALL_YEARLY: parseFloat(process.env.BORROW_RATE_SMALL_YEARLY as string) || 15,
    BORROW_RATE_BIG_BUSINESS_YEARLY: parseFloat(process.env.BORROW_RATE_BIG_BUSINESS_YEARLY as string) || 12,
    /** Max borrow amount (in borrowed asset units) to be classified as "small". Above = big business. */
    BORROW_THRESHOLD_SMALL_MAX: process.env.BORROW_THRESHOLD_SMALL_MAX as string || '10000',
    /** All platform fees (0.6% on payouts, lending, etc.) are sent to this Stellar public key. Derived from PLATFORM_ISSUER_SECRET if unset. */
    PLATFORM_FEE_PUBLIC_KEY: (process.env.PLATFORM_FEE_PUBLIC_KEY as string)?.trim() || derivedPlatformPublicKey,
    /** Platform custody/commit destination (savings, lending, launch commit). Derived from PLATFORM_ISSUER_SECRET. */
    PLATFORM_CUSTODY_PUBLIC_KEY: derivedPlatformPublicKey,
    /** Base rate (e.g. savings floor) in % for indices. Used by getIndex('baseRate'). */
    SAVINGS_BASE_RATE: parseFloat(process.env.SAVINGS_BASE_RATE as string) || parseFloat(process.env.BASE_RATE as string) || 2,
    /** Reserve buffer ratio (0–1) for lending: available = totalSupply - totalBorrow - (totalSupply * ratio). E.g. 0.05 = 5%. */
    RESERVE_BUFFER_RATIO: parseFloat(process.env.RESERVE_BUFFER_RATIO as string) || 0,
}

export default env;