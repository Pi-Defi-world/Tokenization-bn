import StellarSdk from '@stellar/stellar-sdk';
import env from './env';
import { logger } from '../utils/logger';


export const server = new StellarSdk.Horizon.Server(env.HORIZON_URL);

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
