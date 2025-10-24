import  StellarSdk from '@stellar/stellar-sdk';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { logger } from './logger';
import env from '../config/env';


export const getKeypairFromMnemonic = async (mnemonic: string) => {
    
  const seed = await bip39.mnemonicToSeed(mnemonic);
  //@ts-ignore
  const { key } = derivePath(env.BIP44_PATH, seed as str);
  const keypair = StellarSdk.Keypair.fromRawEd25519Seed(key);

  logger.success('✅ Derived keypair from mnemonic');
  logger.info(`Public Key: ${keypair.publicKey()}`);
  logger.info(`Secret Key: ${keypair.secret()}`);

  return keypair;
};

export const getKeypairFromSecret = (secret: string) => {
  const keypair = StellarSdk.Keypair.fromSecret(secret);
  logger.info(`Loaded keypair from secret`);
  logger.info(`Public Key: ${keypair.publicKey()}`);
  return keypair;
};
