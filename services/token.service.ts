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

  private async loadAccountWithFallback(publicKey: string): Promise<any> {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        return await server.loadAccount(publicKey);
      } catch (error: any) {
        const isNotFoundError =
          error?.response?.status === 404 ||
          error?.constructor?.name === 'NotFoundError' ||
          (error?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found') ||
          (error?.response?.data?.status === 404) ||
          (error?.message && (
            error.message.toLowerCase().includes('not found') ||
            error.message.toLowerCase().includes('404')
          ));

        if (isNotFoundError && attempt === maxRetries) {
          // Try HTTP fallback on last attempt
          logger.warn(`SDK failed to load account ${publicKey}, trying HTTP fallback...`);
          try {
            const horizonUrl = env.HORIZON_URL;
            const accountUrl = `${horizonUrl}/accounts/${publicKey}`;
            const response = await axios.get(accountUrl, { timeout: 10000 });
            
            if (response.status === 200 && response.data) {
              const accountData = response.data;
              const account = new StellarSdk.Account(publicKey, accountData.sequence);
              // Manually attach balances from HTTP response
              (account as any).balances = accountData.balances || [];
              logger.info(`🔹 Account loaded via HTTP fallback: ${publicKey}`);
              return account;
            }
          } catch (httpError: any) {
            logger.error(`HTTP fallback also failed for account ${publicKey}: ${httpError?.message || String(httpError)}`);
          }
        }
        
        if (attempt === maxRetries) {
          logger.error(`🔴 Failed to load account ${publicKey} after ${maxRetries} attempts`);
          throw error;
        }
      }
    }
    
    throw new Error(`Failed to load account ${publicKey}`);
  }

  async establishTrustline(
    userSecret: string,
    assetCode: string,
    issuer: string,
    limit = "10000000000"
  ) {
    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const userPublicKey = user.publicKey();
    
    // Load account with fallback mechanism
    const account = await this.loadAccountWithFallback(userPublicKey);

    // Check if trustline already exists (case-insensitive)
    const assetCodeUpper = assetCode.toUpperCase();
    const trustlineExists = account!.balances.some(
      (b: any) => b.asset_code && b.asset_code.toUpperCase() === assetCodeUpper && b.asset_issuer === issuer
    );

    if (trustlineExists) {
      logger.info(`🔹 Trustline for ${assetCode} already exists on ${userPublicKey}`);
      return { success: true };
    }

    try {
      const asset = getAsset(assetCode, issuer);
      let fee: string = "100000";
      try {
        const fetchedFee = await server.fetchBaseFee();
        fee = fetchedFee.toString();
      } catch (feeError: any) {
        // Use default fee
      }

      // Reload account right before building to ensure fresh sequence number
      const freshAccount = await this.loadAccountWithFallback(userPublicKey);
      const tx = new StellarSdk.TransactionBuilder(freshAccount, {
        fee,
        networkPassphrase: env.NETWORK,
      })
        .addOperation(StellarSdk.Operation.changeTrust({ asset, limit }))
        .setTimeout(300)
        .build();

      tx.sign(user);
      
      try {
        const txXdr = tx.toXDR();
        const submitUrl = `${env.HORIZON_URL}/transactions`;
        
        const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        });
        
        logger.success(`✅ Trustline established - Hash: ${response.data.hash}`);
        return { success: true };
      } catch (submitError: any) {
        logger.error(`Trustline transaction failed: ${submitError.response?.data?.extras?.result_codes || submitError.message}`);
        throw submitError;
      }
    } catch (err: any) {
      logger.error(`Failed to establish trustline: ${err.message || err}`);
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
        `🔹 Home domain "${domain}" set successfully for issuer: ${issuer.publicKey()}`
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
        `🔴 Failed to set home domain "${homeDomain}" for issuer: ${issuerPublicKey}`
      );
      if (err.response?.data) {
        logger.error(`Error:`, err);
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
        homeDomain || `https://www.zyradex.com/${assetCode}`;

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
                  logger.warn(`🔴 Failed to reload issuer account after ${maxRetries} attempts, using original account`);
                }
              }
            }
          }
        } catch (homeDomainError: any) {
          logger.warn(`🔴 Failed to set home domain, continuing: ${homeDomainError.message}`);
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

      const distributorAccount = await this.loadAccountWithFallback(distributorPublicKey);
      const nativeBalance = distributorAccount.balances.find((b: any) => b.asset_type === 'native');
      const distributorBalance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
      
      const baseReserve = 1.0;
      const subentryReserve = 0.5;
      const subentryCount = (distributorAccount as any).subentry_count || 
        distributorAccount.balances.filter((b: any) => 
          b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'
        ).length;
      const totalReserve = baseReserve + (subentryCount * subentryReserve);
      const availableBalance = distributorBalance - totalReserve;

      let fee: string = "100000";
      try {
        const fetchedFee = await server.fetchBaseFee();
        fee = fetchedFee.toString();
      } catch (feeError: any) {
        // Use default fee
      }

      const feeRecipientPublicKey = env.PI_TEST_USER_PUBLIC_KEY;
      const platformFeeAmount = env.PLATFORM_MINT_FEE;
      const baseFeeNum = parseFloat(fee);
      const platformFeeNum = parseFloat(platformFeeAmount);
      const transactionFeeNum = baseFeeNum / 10000000;
      const totalRequired = platformFeeNum + transactionFeeNum;
      
      // Balance check in stroops for precision
      const balanceStroops = nativeBalance ? 
        (typeof nativeBalance.balance === 'string' ? 
          Math.floor(parseFloat(nativeBalance.balance) * 10000000) : 
          Math.floor(nativeBalance.balance * 10000000)) : 0;
      const reserveStroops = Math.ceil(totalReserve * 10000000);
      const availableStroops = balanceStroops - reserveStroops;
      const platformFeeStroops = Math.floor(parseFloat(platformFeeAmount) * 10000000);
      const requiredStroops = platformFeeStroops + parseInt(fee);
      
      if (availableStroops < requiredStroops || availableBalance < totalRequired) {
        throw new Error(`Insufficient balance. Available: ${(availableStroops / 10000000).toFixed(7)} Pi, Required: ${(requiredStroops / 10000000).toFixed(7)} Pi`);
      }

      // Transaction 1: Distributor pays platform fee
      
      // Reload account right before building to ensure fresh sequence number and avoid tx_too_late
      const freshDistributorAccount = await this.loadAccountWithFallback(distributorPublicKey);
      
      // Final balance check right before building transaction
      const freshNativeBalance = freshDistributorAccount.balances.find((b: any) => b.asset_type === 'native');
      const freshDistributorBalance = freshNativeBalance ? parseFloat(freshNativeBalance.balance) : 0;
      
      // Get the actual minimum balance from Stellar (most accurate)
      const stellarMinBalance = (freshDistributorAccount as any).minimum_balance || 
        (freshDistributorAccount as any).minimumBalance;
      
      const freshSubentryCount = (freshDistributorAccount as any).subentry_count || 
        freshDistributorAccount.balances.filter((b: any) => 
          b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'
        ).length;
      
      // Use Stellar's minimum balance if available, otherwise calculate
      const freshTotalReserve = stellarMinBalance ? 
        (typeof stellarMinBalance === 'string' ? parseFloat(stellarMinBalance) : stellarMinBalance) / 10000000 : // Convert stroops to Pi
        baseReserve + (freshSubentryCount * subentryReserve);
      
      const freshAvailableBalance = freshDistributorBalance - freshTotalReserve;
      
      
      const feeTxBuilder = new StellarSdk.TransactionBuilder(freshDistributorAccount, {
        fee,
        networkPassphrase: env.NETWORK,
      });

      feeTxBuilder.addOperation(
        StellarSdk.Operation.payment({
          destination: feeRecipientPublicKey,
          asset: StellarSdk.Asset.native(), // Native Pi
          amount: platformFeeAmount,
        })
      );
        logger.info(`� Adding platform fee: ${platformFeeAmount} Pi to ${feeRecipientPublicKey}`);
      

      const feeTx = feeTxBuilder.setTimeout(300).build(); // Increased timeout to 5 minutes to avoid tx_too_late
      feeTx.sign(distributor);

      // Reload account before submission
      const preSubmitAccount = await this.loadAccountWithFallback(distributorPublicKey);
      const finalFeeTxBuilder = new StellarSdk.TransactionBuilder(preSubmitAccount, {
        fee,
        networkPassphrase: env.NETWORK,
      });

      finalFeeTxBuilder.addOperation(
        StellarSdk.Operation.payment({
          destination: feeRecipientPublicKey,
          asset: StellarSdk.Asset.native(),
          amount: platformFeeAmount,
        })
      );

      const finalFeeTx = finalFeeTxBuilder.setTimeout(300).build();
      finalFeeTx.sign(distributor);
      
      try {
        const feeTxXdr = finalFeeTx.toXDR();
        const submitUrl = `${env.HORIZON_URL}/transactions`;
        
        const feeResponse = await axios.post(submitUrl, `tx=${encodeURIComponent(feeTxXdr)}`, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        });
        
        logger.success(`✅ Platform fee paid - Hash: ${feeResponse.data.hash}`);
        
        // Wait a moment for the transaction to be processed
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (feeError: any) {
        logger.error(`Platform fee transaction failed: ${feeError.response?.data?.extras?.result_codes || feeError.message}`);
        throw feeError;
      }

      // Transaction 2: Issuer sends tokens to distributor
      const freshIssuerAccount = await this.loadAccountWithFallback(issuerPublicKey);
      
      const tokenTxBuilder = new StellarSdk.TransactionBuilder(freshIssuerAccount, {
        fee,
        networkPassphrase: env.NETWORK,
      });

      tokenTxBuilder.addOperation(
        StellarSdk.Operation.payment({
          destination: distributorPublicKey,
          asset,
          amount: totalSupply,
        })
      );
      const tx = tokenTxBuilder.setTimeout(300).build();
      tx.sign(issuer);

      // Submit token payment transaction
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
        
        logger.success(`� Token minted successfully - Hash: ${result.hash}`);
      } catch (submitError: any) {
        logger.error(`Token payment failed: ${submitError.response?.data?.extras?.result_codes || submitError.message}`);
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

      logger.success(`🔹 Token saved to database - ID: ${token._id}`);

       
      this.accountService.clearBalanceCache(distributorPublicKey).catch((error) => {
        logger.warn(`Failed to clear balance cache after token mint: ${error instanceof Error ? error.message : String(error)}`);
      });

      return token;
    } catch (err: any) {
      logger.error("🔴 Error in mintToken");
      if (err.response?.data) {
        const errorData = err.response.data;
        if (errorData.extras?.result_codes) {
          logger.error(`Result codes:`, errorData.extras.result_codes);
        }
        logger.error(`Error:`, err);
      } else {
        logger.error(`Error:`, err);
      }
      throw err;
    }
  }

  async getTokens() {
    try {
      const tokens = await Token.find({});
      return tokens;
    } catch (err: any) {
      logger.error("🔴 Error in getTokens:", err);
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

      logger.success(`🔹 Burned ${amount} ${assetCode}. Transaction hash: ${result.hash}`);
      return result;
    } catch (err: any) {
      logger.error("🔴 Error burning token:", err);
      throw err;
    }
  }
}

export const tokenService = new TokenService();