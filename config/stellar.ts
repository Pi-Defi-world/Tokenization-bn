import StellarSdk from '@stellar/stellar-sdk';
import env from './env';
import { logger } from '../utils/logger';

// Primary server (default - Pi Network)
// Note: Stellar SDK Server constructor only accepts the Horizon URL
export const server = new StellarSdk.Horizon.Server(env.HORIZON_URL);

// Log server configuration at startup
logger.info(`🔹 Pi Network Horizon Server configured: ${env.HORIZON_URL}`);
if (!env.HORIZON_URL.includes('minepi.com')) {
  logger.error(`⚠️ WARNING: HORIZON_URL does not appear to be Pi Network! Using: ${env.HORIZON_URL}`);
  logger.error(`⚠️ Expected Pi Network URLs: https://api.testnet.minepi.com or https://api.mainnet.minepi.com`);
}

// Secondary server (fallback - Pi Network testnet, only if different from primary)
const piTestnetUrl = env.horizon?.pi?.testnet || 'https://api.testnet.minepi.com';
export const serverFallback = env.HORIZON_URL !== piTestnetUrl
  ? new StellarSdk.Horizon.Server(piTestnetUrl)
  : server;

export const getBalanceCheckServers = () => {
  const servers: (typeof server)[] = [];
  
  // Primary: Current configured Horizon URL (Pi Network)
  servers.push(server);
  
  // Fallback: Pi Network testnet (if different from primary)
  if (env.HORIZON_URL !== piTestnetUrl) {
    servers.push(serverFallback);
  }
  
  logger.info(`Configured ${servers.length} Pi Network Horizon server(s) for balance checks`);
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
