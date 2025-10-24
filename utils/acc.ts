import { server } from '../config/stellar';
import { logger } from '../utils/logger';

const getAccountInfo = async (publicKey: string) => {
  try {
    logger.info(`🔎 Loading account: ${publicKey}`);
    const account = await server.loadAccount(publicKey);
    const homeDomain = account.homeDomain;
    const balances = account.balances;
    const subentryCount = account.subentry_count;
    const signers = account.signers;
    return { homeDomain, balances, subentryCount, signers, raw: account };
  } catch (err: any) {
    logger.error('❌ Error loading account:', err);
    throw err;
  }
};

const findAssetIssuers = async (assetCode: string, limit = 10) => {
  try {
    logger.info(`🔎 Searching Horizon for asset code: ${assetCode}`);
    const resp = await server.assets().forCode(assetCode).limit(limit).call();
    console.log(resp.records);
    return resp.records;
  } catch (err: any) {
    logger.error('❌ Error searching assets:', err);
    throw err;
  }
};

findAssetIssuers("ZYRA")