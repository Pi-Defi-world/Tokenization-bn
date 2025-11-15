import * as StellarSdk from "@stellar/stellar-sdk";
import { server, getAsset } from "../config/stellar";
import env from "../config/env";
import { logger } from "../utils/logger";
import Token from "../models/Token";
import { ICreateTokenPayload } from "../types";

export interface MintTokenParams {
  distributorSecret: string;
  assetCode: string;
  totalSupply: string;
  data: ICreateTokenPayload;
  homeDomain?: string;
}

class TokenService {
  async establishTrustline(
    userSecret: string,
    assetCode: string,
    issuer: string,
    limit = "10000000000"
  ) {
    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      logger.info(`🔹 Establishing trustline for user: ${user.publicKey()}`);

      const account = await server.loadAccount(user.publicKey());
      const asset = getAsset(assetCode, issuer);
      const fee = (await server.fetchBaseFee()).toString();

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee,
        networkPassphrase: env.NETWORK,
      })
        .addOperation(StellarSdk.Operation.changeTrust({ asset, limit }))
        .setTimeout(60)
        .build();

      tx.sign(user);

      const result = await server.submitTransaction(tx);
      logger.success(
        `✅ Trustline established for ${asset.getCode()} on ${user.publicKey()}`
      );
      return result;
    } catch (err: any) {
      const userPublicKey = (() => {
        try {
          return StellarSdk.Keypair.fromSecret(userSecret).publicKey();
        } catch {
          return "unknown";
        }
      })();

      logger.error(
        `❌ Failed to establish trustline for asset ${assetCode} (issuer: ${issuer}) for user: ${userPublicKey}`
      );
      logger.error(JSON.stringify(err.response?.data || err.message));
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
      
      logger.info(
        `🔹 Setting home domain "${domain}" for issuer: ${issuer.publicKey()}`
      );
      
      const issuerAccount = await server.loadAccount(issuer.publicKey());
      
      // Check if home domain is already set to the same value
      if (issuerAccount.home_domain === domain) {
        logger.info(`ℹ️ Home domain already set to "${domain}"`);
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
      logger.error(JSON.stringify(err.response?.data || err.message));
      throw err;
    }
  }

  async mintToken(params: MintTokenParams) {
    const { distributorSecret, assetCode, totalSupply, data, homeDomain } =
      params;

    try {
      logger.info("🔹 Starting mintToken function");

      const issuer = StellarSdk.Keypair.fromSecret(env.PLATFORM_ISSUER_SECRET);
      const issuerPublicKey = issuer.publicKey();
      const finalHomeDomain =
        homeDomain || `https://www.zyrapay.net/${assetCode}`;

      // Load issuer account first to verify it exists
      // Add retry logic in case of temporary Horizon API issues
      logger.info(`🔹 Loading issuer account: ${issuerPublicKey}`);
      logger.info(`   Horizon URL: ${env.HORIZON_URL}`);
      let issuerAccount;
      const maxRetries = 3;
      let lastError: any = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            logger.info(`   Retry attempt ${attempt}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          }
          issuerAccount = await server.loadAccount(issuerPublicKey);
          logger.info(`✅ Issuer account loaded successfully`);
          logger.info(`   Account sequence: ${issuerAccount.sequenceNumber()}`);
          logger.info(`   Account balances: ${JSON.stringify(issuerAccount.balances)}`);
          break; // Success, exit retry loop
        } catch (accountError: any) {
          lastError = accountError;
          logger.warn(`   Attempt ${attempt} failed: ${accountError.message}`);
          if (accountError.response) {
            logger.warn(`   Response status: ${accountError.response.status}`);
          }
          if (attempt === maxRetries) {
            // Final attempt failed
            logger.error(`❌ Issuer account not found after ${maxRetries} attempts: ${issuerPublicKey}`);
            logger.error(`   Error: ${accountError.message || JSON.stringify(accountError)}`);
            if (accountError.response) {
              logger.error(`   Response status: ${accountError.response.status}`);
              logger.error(`   Response data: ${JSON.stringify(accountError.response.data, null, 2)}`);
            }
            // Log the full error details for debugging
            const errorDetails = accountError.response?.data 
              ? JSON.stringify(accountError.response.data, null, 2)
              : accountError.message;
            
            throw new Error(
              `Failed to load issuer account ${issuerPublicKey} from Horizon API after ${maxRetries} attempts. ` +
              `Error: ${accountError.message}. ` +
              `Horizon URL: ${env.HORIZON_URL}. ` +
              `Check logs for full error details. Possible causes: API sync delay, network issue, or incorrect Horizon URL.`
            );
          }
        }
      }
      
      // Set home domain if needed (this will update the account sequence)
      let homeDomainWasSet = false;
      if (finalHomeDomain) {
        try {
          const homeDomainResult = await this.setHomeDomain(env.PLATFORM_ISSUER_SECRET, finalHomeDomain);
          if (homeDomainResult && homeDomainResult.hash !== 'no-op') {
            homeDomainWasSet = true;
            logger.info(`🔹 Home domain was updated, reloading issuer account to get new sequence...`);
            // Reload account to get updated sequence number after home domain change
            await new Promise(resolve => setTimeout(resolve, 2000)); // Delay for ledger propagation
            
            // Retry reloading the account
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                if (attempt > 1) {
                  logger.info(`   Reload retry attempt ${attempt}/${maxRetries}...`);
                  await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
                issuerAccount = await server.loadAccount(issuerPublicKey);
                logger.info(`✅ Issuer account reloaded with new sequence: ${issuerAccount.sequenceNumber()}`);
                break;
              } catch (reloadError: any) {
                if (attempt === maxRetries) {
                  logger.warn(`⚠️ Failed to reload issuer account after home domain update, using original account`);
                  // Continue with original account - sequence might still work
                }
              }
            }
          }
        } catch (homeDomainError: any) {
          logger.warn(
            `⚠️ Failed to set home domain, continuing with mint: ${homeDomainError.message}`
          );
          // Continue with mint even if home domain setting fails
        }
      }
      
      const asset = getAsset(assetCode, issuer.publicKey());

      const distributor = StellarSdk.Keypair.fromSecret(distributorSecret);
      const distributorPublicKey = distributor.publicKey();
      logger.info(`💳 Distributor keypair created: ${distributorPublicKey}`);

      // Check if distributor account exists with retry logic
      logger.info(`🔹 Checking if distributor account exists: ${distributorPublicKey}`);
      let distributorAccount;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            logger.info(`   Retry attempt ${attempt}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          }
          distributorAccount = await server.loadAccount(distributorPublicKey);
          logger.info(`✅ Distributor account exists`);
          logger.info(`   Account sequence: ${distributorAccount.sequenceNumber()}`);
          break; // Success, exit retry loop
        } catch (accountError: any) {
          if (attempt === maxRetries) {
            logger.error(`❌ Distributor account not found after ${maxRetries} attempts: ${distributorPublicKey}`);
            logger.error(`   Error: ${accountError.message || JSON.stringify(accountError)}`);
            if (accountError.response) {
              logger.error(`   Response status: ${accountError.response.status}`);
              logger.error(`   Response data: ${JSON.stringify(accountError.response.data, null, 2)}`);
            }
            // Log the full error details for debugging
            const errorDetails = accountError.response?.data 
              ? JSON.stringify(accountError.response.data, null, 2)
              : accountError.message;
            
            throw new Error(
              `Failed to load distributor account ${distributorPublicKey} from Horizon API after ${maxRetries} attempts. ` +
              `Error: ${accountError.message}. ` +
              `Horizon URL: ${env.HORIZON_URL}. ` +
              `Check logs for full error details. Possible causes: API sync delay, network issue, or incorrect Horizon URL.`
            );
          } else {
            logger.warn(`   Attempt ${attempt} failed: ${accountError.message}`);
          }
        }
      }

      logger.info(`🔹 Establishing trustline for distributor...`);
      await this.establishTrustline(
        distributorSecret,
        assetCode,
        issuer.publicKey()
      );

      logger.info(`🔹 Creating payment transaction: ${totalSupply} ${assetCode} to ${distributorPublicKey}`);
      logger.info(`   Asset: ${asset.getCode()} issued by ${asset.getIssuer()}`);
      logger.info(`   Issuer account flags: ${JSON.stringify({
        authRequired: issuerAccount.flags.auth_required,
        authRevocable: issuerAccount.flags.auth_revocable,
        authImmutable: issuerAccount.flags.auth_immutable,
        authClawbackEnabled: issuerAccount.flags.auth_clawback_enabled
      })}`);
      
      // Check issuer balances to see if they already have this asset
      const issuerHasAsset = issuerAccount.balances.some((b: any) => 
        b.asset_code === assetCode && b.asset_issuer === issuerPublicKey
      );
      logger.info(`   Issuer already has ${assetCode} balance: ${issuerHasAsset}`);
      
      // Note: In Stellar, the issuer can send their own asset without having it in balance
      // The payment operation from issuer creates the asset
      
      const fee = (await server.fetchBaseFee()).toString();

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
      logger.info(`🔹 Transaction signed, submitting...`);

      let result;
      try {
        result = await server.submitTransaction(tx);
        logger.success("🚀 Token minted successfully");
        logger.info(`Transaction hash: ${result.hash}`);
      } catch (submitError: any) {
        logger.error(`❌ Transaction submission failed`);
        logger.error(`   Error type: ${submitError.constructor.name}`);
        logger.error(`   Error message: ${submitError.message}`);
        logger.error(`   Full error object: ${JSON.stringify(submitError, Object.getOwnPropertyNames(submitError), 2)}`);
        
        // Log detailed Stellar error if available - check multiple possible structures
        if (submitError.response) {
          logger.error(`   Response status: ${submitError.response.status}`);
          logger.error(`   Response data: ${JSON.stringify(submitError.response.data, null, 2)}`);
          
          if (submitError.response.data?.extras?.result_codes) {
            logger.error(`   Result codes: ${JSON.stringify(submitError.response.data.extras.result_codes, null, 2)}`);
          }
          
          if (submitError.response.data?.extras?.result_xdr) {
            logger.error(`   Result XDR: ${submitError.response.data.extras.result_xdr}`);
          }
        }
        
        // Check for Stellar SDK specific error properties
        if (submitError.responseData) {
          logger.error(`   ResponseData: ${JSON.stringify(submitError.responseData, null, 2)}`);
        }
        
        if (submitError.extras) {
          logger.error(`   Extras: ${JSON.stringify(submitError.extras, null, 2)}`);
        }
        
        // Log the entire error to see its structure
        logger.error(`   Error keys: ${Object.keys(submitError).join(', ')}`);
        
        throw submitError;
      }

      logger.info(`🔹 Saving token to database...`);
      const token = await Token.create({
        ...data,
        assetCode,
        issuer: issuer.publicKey(),
        distributor: distributorPublicKey,
        totalSupply: data.totalSupply,
        homeDomain: finalHomeDomain,
      });

      logger.success(`✅ Token saved to database with ID: ${token._id}`);
      return token;
    } catch (err: any) {
      logger.error("❌ Error in mintToken:", err);
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
      logger.info(`🔹 Burning ${amount} ${assetCode} tokens`);

      const holderKeypair = StellarSdk.Keypair.fromSecret(holderSecret);
      const holderPublic = holderKeypair.publicKey();
      const issuerAccount = await server.loadAccount(holderPublic);

      const asset = new StellarSdk.Asset(assetCode, issuer);

      await this.establishTrustline(
        holderSecret,
        assetCode,
        issuer
      );

      const burnAddress ='GDX3VYTSBJTDKIKBGDBA7E226GIZNGIE3KRFED6LFWL6EQJ4SNZE5PBW'

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
