import * as StellarSdk from "@stellar/stellar-sdk";
import { server, getAsset } from "../config/stellar";
import env from "../config/env";
import { logger } from "../utils/logger";
import Token from "../models/Token";
import { ICreateTokenPayload } from "../types";
import axios from "axios";
import { AccountService } from "./account.service";

export interface MintTokenParams {
  distributorSecret: string;
  assetCode: string;
  totalSupply: string;
  data: ICreateTokenPayload;
  homeDomain?: string;
}

class TokenService {
  private accountService: AccountService;

  constructor() {
    this.accountService = new AccountService();
  }

  async establishTrustline(
    userSecret: string,
    assetCode: string,
    issuer: string,
    limit = "10000000000"
  ) {
    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const userPublicKey = user.publicKey();
    
    // Retry logic for loading account (Horizon API can be flaky)
    let account;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        account = await server.loadAccount(userPublicKey);
        break;
      } catch (loadError: any) {
        if (attempt === maxRetries) {
          logger.error(`❌ Failed to load account ${userPublicKey} after ${maxRetries} attempts`);
          throw loadError;
        }
      }
    }

    // Check if trustline already exists
    const trustlineExists = account!.balances.some(
      (b: any) => b.asset_code === assetCode && b.asset_issuer === issuer
    );

    if (trustlineExists) {
      logger.info(`ℹ️ Trustline for ${assetCode} already exists on ${userPublicKey}`);
      return { success: true };
    }

    try {
      const asset = getAsset(assetCode, issuer);
      let fee: string = "100000"; // Default fee: 0.01 Pi
      try {
        const fetchedFee = await server.fetchBaseFee();
        fee = fetchedFee.toString();
      } catch (feeError: any) {
        logger.warn(`⚠️ Failed to fetch base fee, using default (0.01 Pi)`);
      }

      const tx = new StellarSdk.TransactionBuilder(account!, {
        fee,
        networkPassphrase: env.NETWORK,
      })
        .addOperation(StellarSdk.Operation.changeTrust({ asset, limit }))
        .setTimeout(60)
        .build();

      tx.sign(user);
      await server.submitTransaction(tx);
      
      logger.success(
        `✅ Trustline established for ${asset.getCode()} on ${userPublicKey}`
      );
      return { success: true };
    } catch (err: any) {
      logger.error(
        `❌ Failed to establish trustline for asset ${assetCode} (issuer: ${issuer}) for user: ${userPublicKey}`
      );
      if (err.response?.data) {
        logger.error(`Error: ${JSON.stringify(err.response.data)}`);
      } else {
        logger.error(`Error: ${err.message}`);
      }
      throw err;
    }
  }

  private extractDomain(homeDomain: string): string {
    try {
      // If it's already just a domain, return as is
      if (!homeDomain.includes('://') && !homeDomain.includes('/')) {
        return homeDomain;
      }
      
      // Extract domain from URL
      const url = new URL(homeDomain.startsWith('http') ? homeDomain : `https://${homeDomain}`);
      return url.hostname;
    } catch {
      // If URL parsing fails, try to extract domain manually
      const match = homeDomain.match(/(?:https?:\/\/)?([^\/]+)/);
      return match ? match[1] : homeDomain;
    }
  }

  async setHomeDomain(issuerSecret: string, homeDomain: string) {
    try {
      const issuer = StellarSdk.Keypair.fromSecret(issuerSecret);
      const domain = this.extractDomain(homeDomain);
      const issuerAccount = await server.loadAccount(issuer.publicKey());
      
      if (issuerAccount.home_domain === domain) {
        return { hash: 'no-op' };
      }
      
      const fee = (await server.fetchBaseFee()).toString();

      const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
        fee,
        networkPassphrase: env.NETWORK,
      })
        .addOperation(StellarSdk.Operation.setOptions({ homeDomain: domain }))
        .setTimeout(60)
        .build();

      tx.sign(issuer);
      const result = await server.submitTransaction(tx);

      logger.success(
        `✅ Home domain "${domain}" set successfully for issuer: ${issuer.publicKey()}`
      );
      return result;
    } catch (err: any) {
      const issuerPublicKey = (() => {
        try {
          return StellarSdk.Keypair.fromSecret(issuerSecret).publicKey();
        } catch {
          return "unknown";
        }
      })();

      logger.error(
        `❌ Failed to set home domain "${homeDomain}" for issuer: ${issuerPublicKey}`
      );
      if (err.response?.data) {
        logger.error(`Error: ${JSON.stringify(err.response.data)}`);
      } else {
        logger.error(`Error: ${err.message}`);
      }
      throw err;
    }
  }

  async mintToken(params: MintTokenParams) {
    const { distributorSecret, assetCode, totalSupply, data, homeDomain } =
      params;

    try {
      const issuer = StellarSdk.Keypair.fromSecret(env.PLATFORM_ISSUER_SECRET);
      const issuerPublicKey = issuer.publicKey();
      const finalHomeDomain =
        homeDomain || `https://www.zyrapay.net/${assetCode}`;

      // Load issuer account
      let issuerAccount = await server.loadAccount(issuerPublicKey);

      // Set home domain if needed (optional, non-blocking)
      if (finalHomeDomain) {
        try {
          const homeDomainResult = await this.setHomeDomain(env.PLATFORM_ISSUER_SECRET, finalHomeDomain);
          if (homeDomainResult && homeDomainResult.hash !== 'no-op') {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const maxRetries = 3;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                if (attempt > 1) {
                  await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
                issuerAccount = await server.loadAccount(issuerPublicKey);
                break;
              } catch (reloadError: any) {
                if (attempt === maxRetries) {
                  logger.warn(`⚠️ Failed to reload issuer account after ${maxRetries} attempts, using original account`);
                }
              }
            }
          }
        } catch (homeDomainError: any) {
          logger.warn(`⚠️ Failed to set home domain, continuing: ${homeDomainError.message}`);
        }
      }

      // Prepare asset and distributor
      const asset = getAsset(assetCode, issuerPublicKey);
      const distributor = StellarSdk.Keypair.fromSecret(distributorSecret);
      const distributorPublicKey = distributor.publicKey();

      // Establish trustline
      await this.establishTrustline(
        distributorSecret,
        assetCode,
        issuerPublicKey
      );

      // Create payment transaction
      let fee: string = "100000"; // Default fee: 0.01 Pi
      try {
        const fetchedFee = await server.fetchBaseFee();
        fee = fetchedFee.toString();
      } catch (feeError: any) {
        logger.warn(`⚠️ Failed to fetch base fee, using default (0.01 Pi)`);
      }

      const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
        fee,
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: distributorPublicKey,
            asset,
            amount: totalSupply,
          })
        )
        .setTimeout(60)
        .build();

      tx.sign(issuer);

      // Submit transaction (workaround for SDK v14 bug)
      let result;
      try {
        const txXdr = tx.toXDR();
        const submitUrl = `${env.HORIZON_URL}/transactions`;
        
        const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });
        
        result = {
          hash: response.data.hash,
          ledger: response.data.ledger,
          envelope_xdr: response.data.envelope_xdr,
          result_xdr: response.data.result_xdr,
          result_meta_xdr: response.data.result_meta_xdr,
        };
        
        logger.success(`🚀 Token minted successfully - Hash: ${result.hash}`);
      } catch (submitError: any) {
        logger.error(`❌ Transaction submission failed`);
        if (submitError.response?.data) {
          const errorData = submitError.response.data;
          if (errorData.extras?.result_codes) {
            logger.error(`Result codes: ${JSON.stringify(errorData.extras.result_codes)}`);
          }
          logger.error(`Error: ${JSON.stringify(errorData)}`);
        } else {
          logger.error(`Error: ${submitError.message}`);
        }
        throw submitError;
      }

      const token = await Token.create({
        ...data,
        assetCode,
        issuer: issuerPublicKey,
        distributor: distributorPublicKey,
        totalSupply: data.totalSupply,
        homeDomain: finalHomeDomain,
      });

      logger.success(`✅ Token saved to database - ID: ${token._id}`);

      // Clear balance cache for distributor to reflect new token balance
      // This ensures the user sees their new token balance immediately
      this.accountService.clearBalanceCache(distributorPublicKey).catch((error) => {
        logger.warn(`Failed to clear balance cache after token mint: ${error instanceof Error ? error.message : String(error)}`);
      });

      return token;
    } catch (err: any) {
      logger.error("❌ Error in mintToken");
      if (err.response?.data) {
        const errorData = err.response.data;
        if (errorData.extras?.result_codes) {
          logger.error(`Result codes: ${JSON.stringify(errorData.extras.result_codes)}`);
        }
        logger.error(`Error: ${JSON.stringify(errorData)}`);
      } else {
        logger.error(`Error: ${err.message || JSON.stringify(err)}`);
      }
      throw err;
    }
  }

  async getTokens() {
    try {
      const tokens = await Token.find({});
      return tokens;
    } catch (err: any) {
      logger.error("❌ Error in getTokens:", err);
      throw err;
    }
  }

  async burnToken({
    holderSecret,
    issuer,
    assetCode,
    amount,
  }: {
    holderSecret: string;
    assetCode: string;
    issuer: string;
    amount: string;
  }) {
    try {
      const holderKeypair = StellarSdk.Keypair.fromSecret(holderSecret);
      const holderPublic = holderKeypair.publicKey();
      const issuerAccount = await server.loadAccount(holderPublic);
      const asset = new StellarSdk.Asset(assetCode, issuer);

      await this.establishTrustline(
        holderSecret,
        assetCode,
        issuer
      );

      const burnAddress ='GAFSXUDWT2P5AOEFD6TGIQSHZ6FEWHNWCS554MZVVUUM3YGI7DB73YWN'
      const fee = (await server.fetchBaseFee()).toString();

      const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
        fee,
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: burnAddress,
            asset,
            amount,
          })
        )
        .setTimeout(30)
        .build();

      tx.sign(holderKeypair);

      const result = await server.submitTransaction(tx);

      logger.success(`✅ Burned ${amount} ${assetCode}. Transaction hash: ${result.hash}`);
      return result;
    } catch (err: any) {
      logger.error("❌ Error burning token:", err);
      throw err;
    }
  }
}

export const tokenService = new TokenService();