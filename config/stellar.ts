import StellarSdk from '@stellar/stellar-sdk';
import env from './env';
import { logger } from '../utils/logger';

// Configure Pi Network Horizon Server with proper timeout and connection settings
// Pi Network Horizon API may need longer timeouts and better connection handling
const serverOptions = {
  timeout: 30000, // 30 seconds timeout for requests
  allowHttp: false, // Only HTTPS for Pi Network
};

// Primary server (default - Pi Network)
export const server = new StellarSdk.Horizon.Server(env.HORIZON_URL, serverOptions);

// Secondary server (fallback - Pi Network testnet, only if different from primary)
const piTestnetUrl = env.horizon?.pi?.testnet || 'https://api.testnet.minepi.com';
export const serverFallback = env.HORIZON_URL !== piTestnetUrl
  ? new StellarSdk.Horizon.Server(piTestnetUrl, serverOptions)
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
