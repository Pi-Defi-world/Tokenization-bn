import dotenv from 'dotenv';

dotenv.config();

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
    /** All platform fees (0.6% on payouts, lending, etc.) are sent to this Stellar public key. */
    PLATFORM_FEE_PUBLIC_KEY: process.env.PLATFORM_FEE_PUBLIC_KEY as string || '',
}

export default env;