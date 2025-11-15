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
      const finalHomeDomain =
        homeDomain || `https://www.zyrapay.net/${assetCode}`;

      // Try to set home domain, but don't fail the entire mint if it fails
      // Home domain is optional and can be set later
      if (finalHomeDomain) {
        try {
          await this.setHomeDomain(env.PLATFORM_ISSUER_SECRET, finalHomeDomain);
        } catch (homeDomainError: any) {
          logger.warn(
            `⚠️ Failed to set home domain, continuing with mint: ${homeDomainError.message}`
          );
          // Continue with mint even if home domain setting fails
        }
      }

      logger.info(`🔹 Loading issuer account: ${issuer.publicKey()}`);
      const issuerAccount = await server.loadAccount(issuer.publicKey());
      logger.info(`✅ Issuer account loaded successfully`);
      
      const asset = getAsset(assetCode, issuer.publicKey());

      const distributor = StellarSdk.Keypair.fromSecret(distributorSecret);
      const distributorPublicKey = distributor.publicKey();
      logger.info(`💳 Distributor keypair created: ${distributorPublicKey}`);

      // Check if distributor account exists before establishing trustline
      try {
        logger.info(`🔹 Checking if distributor account exists: ${distributorPublicKey}`);
        await server.loadAccount(distributorPublicKey);
        logger.info(`✅ Distributor account exists`);
      } catch (accountError: any) {
        logger.error(`❌ Distributor account not found: ${distributorPublicKey}`);
        logger.error(`   Error: ${accountError.message || JSON.stringify(accountError)}`);
        throw new Error(
          `Distributor account ${distributorPublicKey} does not exist on Stellar network. ` +
          `The account must be created and funded before minting tokens.`
        );
      }

      logger.info(`🔹 Establishing trustline for distributor...`);
      await this.establishTrustline(
        distributorSecret,
        assetCode,
        issuer.publicKey()
      );

      logger.info(`🔹 Creating payment transaction: ${totalSupply} ${assetCode} to ${distributorPublicKey}`);
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

      const result = await server.submitTransaction(tx);
      logger.success("🚀 Token minted successfully");
      logger.info(`Transaction hash: ${result.hash}`);

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
