import StellarSdk from '@stellar/stellar-sdk';
import env from './env';
import { logger } from '../utils/logger';

// Primary server (default - Pi Network)
export const server = new StellarSdk.Horizon.Server(env.HORIZON_URL);

// Secondary server (fallback - Pi Network testnet)
export const serverFallback = new StellarSdk.Horizon.Server(
  env.horizon?.pi?.testnet || 'https://api.testnet.minepi.com'
);

// Stellar Horizon servers (third option - official Stellar Horizon)
export const stellarHorizonTestnet = new StellarSdk.Horizon.Server(
  env.horizon?.stellar?.testnet || 'https://horizon-testnet.stellar.org'
);

export const stellarHorizonMainnet = new StellarSdk.Horizon.Server(
  env.horizon?.stellar?.mainnet || 'https://horizon.stellar.org'
);

// Helper function to get all available Horizon servers for balance checks
// Returns servers in order of priority: Pi Network -> Stellar Horizon
export const getBalanceCheckServers = () => {
  const servers: (typeof server)[] = [];
  
  // Primary: Current configured Horizon URL (usually Pi Network)
  servers.push(server);
  
  // Fallback 1: Pi Network testnet (if different from primary)
  const primaryUrl = env.HORIZON_URL;
  const piTestnetUrl = env.horizon?.pi?.testnet || 'https://api.testnet.minepi.com';
  
  if (primaryUrl !== piTestnetUrl) {
    servers.push(serverFallback);
  }
  
  // Fallback 2: Stellar Horizon testnet (third option)
  // Note: Stellar Horizon won't have Pi Network accounts, but useful for cross-checking
  // Only add if we're on testnet (Pi Testnet typically uses testnet)
  const isTestnet = env.NETWORK?.toLowerCase().includes('testnet') || 
                    env.HORIZON_URL?.includes('testnet');
  
  if (isTestnet) {
    servers.push(stellarHorizonTestnet);
  } else {
    servers.push(stellarHorizonMainnet);
  }
  
  return servers;
};

export const getKeypairFromSecret = (secret: string) => {
  const keypair = StellarSdk.Keypair.fromSecret(secret);
  logger.info(`🔹 Loaded keypair from secret`);
  logger.info(`   Public Key: ${keypair.publicKey()}`);
  logger.info(`   Secret Key: ${keypair.secret()}`);
  return keypair;
};

export const getAsset = (code: string, issuer: string) => {
  logger.info(`🔹 Preparing asset`);
  logger.info(`   Asset Code: ${code}`);
  logger.info(`   Issuer: ${issuer}`);
  return new StellarSdk.Asset(code, issuer);
};
