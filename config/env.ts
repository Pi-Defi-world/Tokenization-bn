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
}

export default env;