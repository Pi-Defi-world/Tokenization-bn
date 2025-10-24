import fetch from 'node-fetch';
import { logger } from '../utils/logger';
import { IAssetRecord } from '../types';

export const getTokenMetadata = async (asset: IAssetRecord) => {
  try {
    const tomlUrl = asset._links?.toml?.href?.replace('https://https://', 'https://'); 
    if (!tomlUrl) throw new Error('Missing TOML URL');

    logger.info(`Fetching TOML for ${asset.asset_code} from ${tomlUrl}`);
    const res = await fetch(tomlUrl);
    const text = await res.text();

    const currencyBlock = text
      .split('[[CURRENCIES]]')
      .pop()
      ?.split('[')[0];

    if (!currencyBlock) throw new Error('CURRENCY block missing');

    const imageMatch = currencyBlock.match(/image\s*=\s*"(.*?)"/);
    const nameMatch = currencyBlock.match(/name\s*=\s*"(.*?)"/);
    const descMatch = currencyBlock.match(/desc\s*=\s*"(.*?)"/);
    const codeMatch = currencyBlock.match(/code\s*=\s*"(.*?)"/);
    const issuerMatch = currencyBlock.match(/issuer\s*=\s*"(.*?)"/);

    const metadata = {
      name: nameMatch ? nameMatch[1] : asset.asset_code,
      description: descMatch ? descMatch[1] : '',
      image: imageMatch ? imageMatch[1] : null,
      code: codeMatch ? codeMatch[1] : null,
      issuer: issuerMatch ? issuerMatch[1] : null,
      homeDomain: tomlUrl,
    };

    logger.success(`✅ Metadata fetched for ${asset.asset_code}: ${metadata.name}`);
    return metadata;
  } catch (err: any) {
    logger.error(`❌ Failed to fetch metadata for ${asset.asset_code}: ${err.message}`);
    return {
      name: asset.asset_code,
      description: '',
      image: null,
      homeDomain: null,
      code:null,
      issuer:null
    };
  }
};
