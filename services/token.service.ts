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
      let fee: string = "100000"; // Default fee: 0.01 Pi
      try {
        const fetchedFee = await server.fetchBaseFee();
        fee = fetchedFee.toString();
      } catch (feeError: any) {
        logger.warn(`🔴 Failed to fetch base fee, using default (0.01 Pi)`);
      }

      const tx = new StellarSdk.TransactionBuilder(account!, {
        fee,
        networkPassphrase: env.NETWORK,
      })
        .addOperation(StellarSdk.Operation.changeTrust({ asset, limit }))
        .setTimeout(60)
        .build();

      tx.sign(user);
      
      // Submit transaction using direct HTTP (workaround for SDK v14 bug)
      try {
        const txXdr = tx.toXDR();
        const submitUrl = `${env.HORIZON_URL}/transactions`;
        
        const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        });
        
        logger.success(
          `🔹 Trustline established for ${asset.getCode()} on ${userPublicKey} - Hash: ${response.data.hash}`
        );
        return { success: true };
      } catch (submitError: any) {
        logger.error(`🔴 Trustline transaction submission failed`);
        if (submitError.response?.data) {
          const errorData = submitError.response.data;
          if (errorData.extras?.result_codes) {
            logger.error(`Result codes:`, errorData.extras.result_codes);
          }
          logger.error(`Error:`, submitError);
        } else {
          logger.error(`Error: ${submitError.message}`);
        }
        throw submitError;
      }
    } catch (err: any) {
      logger.error(
        `🔴 Failed to establish trustline for asset ${assetCode} (issuer: ${issuer}) for user: ${userPublicKey}`
      );
      if (err.response?.data) {
        logger.error(`Error:`, err);
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

      // Reload distributor account after trustline (to get updated balance and sequence number)
      logger.info(`🔹 Reloading distributor account after trustline establishment...`);
      const distributorAccount = await this.loadAccountWithFallback(distributorPublicKey);

      // Check distributor balance before transaction
      const nativeBalance = distributorAccount.balances.find((b: any) => b.asset_type === 'native');
      const distributorBalance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
      
      // Calculate minimum reserve requirement
      // Base reserve: 1 Pi for the account
      // Additional reserve: 0.5 Pi per subentry (trustline, offer, data entry, etc.)
      const baseReserve = 1.0; // Base account reserve (in Pi)
      const subentryReserve = 0.5; // Reserve per subentry (in Pi)
      
      // Use subentry_count if available (more accurate), otherwise count from balances
      const subentryCount = (distributorAccount as any).subentry_count || 
        distributorAccount.balances.filter((b: any) => 
          b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'
        ).length;
      
      const totalReserve = baseReserve + (subentryCount * subentryReserve);
      
      // Available balance = total balance - reserve (reserve cannot be spent)
      const availableBalance = distributorBalance - totalReserve;
      
      logger.info(`🔹 Distributor balance breakdown:`);
      logger.info(`   Total balance: ${distributorBalance.toFixed(7)} Test Pi`);
      logger.info(`   Minimum reserve: ${totalReserve.toFixed(7)} Pi (base: ${baseReserve}, subentries: ${subentryCount})`);
      logger.info(`   Available balance: ${availableBalance.toFixed(7)} Test Pi`);

      // Create payment transaction
      let fee: string = "100000"; // Default fee: 0.01 Pi (base fee for blockchain)
      try {
        const fetchedFee = await server.fetchBaseFee();
        fee = fetchedFee.toString();
      } catch (feeError: any) {
        logger.warn(`🔴 Failed to fetch base fee, using default (0.01 Pi)`);
      }

      // Fee recipient is always configured (from env)
      const feeRecipientPublicKey = env.PI_TEST_USER_PUBLIC_KEY;
      // Platform fee: 100 Pi (Stellar SDK expects decimal amount as string, NOT stroops)
      const platformFeeAmount = "100"; // 100 Pi - SDK expects decimal amount, not stroops!
      
      // Calculate required balance: platform fee + transaction fee for first transaction
      // Note: The distributor pays the transaction fee for the platform fee transaction
      // The issuer will pay transaction fees for the token payment transaction
      const baseFeeNum = parseFloat(fee);
      const platformFeeNum = parseFloat(platformFeeAmount); // Already in Pi (100)
      const transactionFeeNum = baseFeeNum / 10000000; // Transaction fee in Pi (fee is in stroops)
      const totalRequired = platformFeeNum + transactionFeeNum; // Platform fee + transaction fee
      
      logger.info(`🔹 Required balance breakdown:`);
      logger.info(`   Platform fee: ${platformFeeNum.toFixed(7)} Pi (paid by distributor)`);
      logger.info(`   Transaction fee (platform fee tx): ${transactionFeeNum.toFixed(7)} Pi (paid by distributor)`);
      logger.info(`   Total required from distributor: ${totalRequired.toFixed(7)} Pi`);
      
      if (availableBalance < totalRequired) {
        const errorMsg = `Insufficient distributor balance. Available: ${availableBalance.toFixed(7)} Test Pi (${distributorBalance.toFixed(7)} total - ${totalReserve.toFixed(7)} reserve), Required: ${totalRequired.toFixed(7)} Test Pi (${platformFeeNum.toFixed(7)} platform fee + ${transactionFeeNum.toFixed(7)} transaction fee)`;
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      logger.info(`✅ Distributor has sufficient balance for transaction`);

      // Reload account one more time right before building transaction to ensure fresh sequence number
      // This prevents sequence number conflicts if other transactions were submitted
      logger.info(`🔹 Reloading distributor account one final time before transaction...`);
      const finalDistributorAccount = await this.loadAccountWithFallback(distributorPublicKey);
      const finalNativeBalance = finalDistributorAccount.balances.find((b: any) => b.asset_type === 'native');
      const finalDistributorBalance = finalNativeBalance ? parseFloat(finalNativeBalance.balance) : 0;
      const finalSubentryCount = (finalDistributorAccount as any).subentry_count || 
        finalDistributorAccount.balances.filter((b: any) => 
          b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'
        ).length;
      const finalTotalReserve = baseReserve + (finalSubentryCount * subentryReserve);
      const finalAvailableBalance = finalDistributorBalance - finalTotalReserve;
      
      logger.info(`🔹 Final balance check:`);
      logger.info(`   Total balance: ${finalDistributorBalance.toFixed(7)} Test Pi`);
      logger.info(`   Reserve: ${finalTotalReserve.toFixed(7)} Pi`);
      logger.info(`   Available: ${finalAvailableBalance.toFixed(7)} Test Pi`);
      logger.info(`   Required: ${totalRequired.toFixed(7)} Test Pi`);
      
      // Also check in stroops to avoid floating point precision issues
      const finalBalanceStroops = finalNativeBalance ? 
        (typeof finalNativeBalance.balance === 'string' ? 
          Math.floor(parseFloat(finalNativeBalance.balance) * 10000000) : 
          Math.floor(finalNativeBalance.balance * 10000000)) : 0;
      const reserveStroops = Math.ceil(finalTotalReserve * 10000000);
      const availableStroops = finalBalanceStroops - reserveStroops;
      // Convert platform fee from Pi to stroops (100 Pi = 1,000,000,000 stroops)
      const platformFeeStroops = Math.floor(parseFloat(platformFeeAmount) * 10000000);
      const requiredStroops = platformFeeStroops + parseInt(fee); // Platform fee + transaction fee
      
      logger.info(`🔹 Balance check in stroops (more precise):`);
      logger.info(`   Total balance: ${finalBalanceStroops} stroops`);
      logger.info(`   Reserve: ${reserveStroops} stroops`);
      logger.info(`   Available: ${availableStroops} stroops`);
      logger.info(`   Required: ${requiredStroops} stroops (${platformFeeStroops} platform fee + ${fee} transaction fee)`);
      
      if (availableStroops < requiredStroops) {
        const errorMsg = `Insufficient distributor balance at transaction time. Available: ${availableStroops} stroops (${(availableStroops / 10000000).toFixed(7)} Pi), Required: ${requiredStroops} stroops (${(requiredStroops / 10000000).toFixed(7)} Pi)`;
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      if (finalAvailableBalance < totalRequired) {
        const errorMsg = `Insufficient distributor balance at transaction time. Available: ${finalAvailableBalance.toFixed(7)} Test Pi, Required: ${totalRequired.toFixed(7)} Test Pi`;
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Build transaction with issuer as source account (issuer pays transaction fees)
      // This way, the distributor only needs to have enough for the platform fee payment
      // Split into two separate transactions to avoid balance validation issues
      // Transaction 1: Distributor pays platform fee
      logger.info(`🔹 Step 1: Distributor pays platform fee (100 Pi)`);
      
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
      
      logger.info(`🔹 Reserve calculation:`);
      logger.info(`   Stellar minimum_balance: ${stellarMinBalance ? (typeof stellarMinBalance === 'string' ? parseFloat(stellarMinBalance) / 10000000 : stellarMinBalance / 10000000).toFixed(7) + ' Pi' : 'not available'}`);
      logger.info(`   Calculated reserve: ${(baseReserve + (freshSubentryCount * subentryReserve)).toFixed(7)} Pi`);
      logger.info(`   Using reserve: ${freshTotalReserve.toFixed(7)} Pi`);
      
      logger.info(`🔹 Pre-transaction balance check (after reload):`);
      logger.info(`   Total balance: ${freshDistributorBalance.toFixed(7)} Pi`);
      logger.info(`   Reserve: ${freshTotalReserve.toFixed(7)} Pi`);
      logger.info(`   Available: ${freshAvailableBalance.toFixed(7)} Pi`);
      logger.info(`   Required: ${totalRequired.toFixed(7)} Pi`);
      
      // Also check in stroops for precision
      const freshBalanceStroops = freshNativeBalance ? 
        (typeof freshNativeBalance.balance === 'string' ? 
          Math.floor(parseFloat(freshNativeBalance.balance) * 10000000) : 
          Math.floor(freshNativeBalance.balance * 10000000)) : 0;
      const freshReserveStroops = Math.ceil(freshTotalReserve * 10000000);
      const freshAvailableStroops = freshBalanceStroops - freshReserveStroops;
      // Convert platform fee from Pi to stroops for stroops-level comparison
      const platformFeeInStroops = Math.floor(parseFloat(platformFeeAmount) * 10000000);
      const requiredStroopsFinal = platformFeeInStroops + parseInt(fee);
      
      logger.info(`🔹 Pre-transaction balance check in stroops:`);
      logger.info(`   Total balance: ${freshBalanceStroops} stroops`);
      logger.info(`   Reserve: ${freshReserveStroops} stroops`);
      logger.info(`   Available: ${freshAvailableStroops} stroops`);
      logger.info(`   Required: ${requiredStroopsFinal} stroops (${platformFeeInStroops} platform fee + ${fee} transaction fee)`);
      
      if (freshAvailableStroops < requiredStroopsFinal) {
        const errorMsg = `Insufficient distributor balance at transaction build time (stroops check). Available: ${freshAvailableStroops} stroops (${(freshAvailableStroops / 10000000).toFixed(7)} Pi), Required: ${requiredStroopsFinal} stroops (${(requiredStroopsFinal / 10000000).toFixed(7)} Pi)`;
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      if (freshAvailableBalance < totalRequired) {
        const errorMsg = `Insufficient distributor balance at transaction build time. Available: ${freshAvailableBalance.toFixed(7)} Pi, Required: ${totalRequired.toFixed(7)} Pi (${platformFeeNum.toFixed(7)} platform fee + ${transactionFeeNum.toFixed(7)} transaction fee)`;
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      logger.info(`✅ Balance confirmed sufficient for transaction`);
      
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
        logger.info(`� Adding platform fee: 100 Pi to ${feeRecipientPublicKey}`);
      

      const feeTx = feeTxBuilder.setTimeout(300).build(); // Increased timeout to 5 minutes to avoid tx_too_late
      feeTx.sign(distributor);

      // Get account data directly from Horizon API to check actual minimum balance
      logger.info(`🔹 Getting account data directly from Horizon API...`);
      try {
        const accountUrl = `${env.HORIZON_URL}/accounts/${distributorPublicKey}`;
        const accountResponse = await axios.get(accountUrl, { timeout: 10000 });
        const accountData = accountResponse.data;
        
        const nativeBal = accountData.balances?.find((b: any) => b.asset_type === 'native');
        const actualBalance = nativeBal ? parseFloat(nativeBal.balance) : 0;
        const actualMinBalance = accountData.balances?.find((b: any) => b.asset_type === 'native')?.min_balance || 
                                 accountData.minimum_balance ? parseFloat(accountData.minimum_balance) / 10000000 : null;
        const actualSubentryCount = accountData.subentry_count || 0;
        
        logger.info(`🔹 Horizon API account data:`);
        logger.info(`   Balance: ${actualBalance.toFixed(7)} Pi`);
        logger.info(`   minimum_balance from API: ${actualMinBalance !== null ? actualMinBalance.toFixed(7) + ' Pi' : 'not in response'}`);
        logger.info(`   subentry_count: ${actualSubentryCount}`);
        logger.info(`   Calculated reserve: ${(baseReserve + (actualSubentryCount * subentryReserve)).toFixed(7)} Pi`);
        
        const actualReserve = actualMinBalance !== null ? actualMinBalance : (baseReserve + (actualSubentryCount * subentryReserve));
        const actualAvailable = actualBalance - actualReserve;
        
        logger.info(`🔹 Actual available balance: ${actualAvailable.toFixed(7)} Pi`);
        logger.info(`🔹 Required: ${totalRequired.toFixed(7)} Pi`);
        
        if (actualAvailable < totalRequired) {
          const errorMsg = `Insufficient balance. Available: ${actualAvailable.toFixed(7)} Pi, Required: ${totalRequired.toFixed(7)} Pi`;
          logger.error(`❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }
      } catch (apiError: any) {
        logger.warn(`Could not fetch account data from Horizon API: ${apiError.message}`);
      }

      // Reload account one final time right before submission
      const preSubmitAccount = await this.loadAccountWithFallback(distributorPublicKey);
      
      // Calculate balance from preSubmitAccount for logging
      const preSubmitNativeBalance = preSubmitAccount.balances.find((b: any) => b.asset_type === 'native');
      const preSubmitBalance = preSubmitNativeBalance ? parseFloat(preSubmitNativeBalance.balance) : 0;
      const preSubmitSubentryCount = (preSubmitAccount as any).subentry_count || 
        preSubmitAccount.balances.filter((b: any) => 
          b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'
        ).length;
      const preSubmitReserve = baseReserve + (preSubmitSubentryCount * subentryReserve);
      const preSubmitAvailable = preSubmitBalance - preSubmitReserve;
      
      // Rebuild transaction with fresh account to ensure correct sequence number
      logger.info(`🔹 Rebuilding transaction with fresh account data...`);
      const finalFeeTxBuilder = new StellarSdk.TransactionBuilder(preSubmitAccount, {
        fee,
        networkPassphrase: env.NETWORK,
      });

      finalFeeTxBuilder.addOperation(
        StellarSdk.Operation.payment({
          destination: feeRecipientPublicKey,
          asset: StellarSdk.Asset.native(), // Native Pi
          amount: platformFeeAmount,
        })
      );

      const finalFeeTx = finalFeeTxBuilder.setTimeout(300).build();
      finalFeeTx.sign(distributor);

      // Submit platform fee transaction first
      logger.info(`🔹 Submitting platform fee transaction...`);
      logger.info(`🔹 Transaction details before submission:`);
      logger.info(`   Source: ${distributorPublicKey}`);
      logger.info(`   Sequence: ${preSubmitAccount.sequenceNumber()}`);
      logger.info(`   Payment amount: ${platformFeeAmount} Pi`);
      logger.info(`   Transaction fee: ${fee} stroops (${transactionFeeNum.toFixed(7)} Pi)`);
      logger.info(`   Account balance: ${preSubmitBalance.toFixed(7)} Pi`);
      logger.info(`   Available balance: ${preSubmitAvailable.toFixed(7)} Pi`);
      
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
        logger.error(`🔴 Platform fee transaction failed`);
        if (feeError.response?.data) {
          const errorData = feeError.response.data;
          if (errorData.extras?.result_codes) {
            logger.error(`Result codes:`, JSON.stringify(errorData.extras.result_codes, null, 2));
            if (errorData.extras.result_codes?.operations?.[0] === 'op_underfunded') {
              logger.error(`🔴 op_underfunded error details:`);
              logger.error(`   Account balance at build: ${freshDistributorBalance.toFixed(7)} Pi`);
              logger.error(`   Reserve: ${freshTotalReserve.toFixed(7)} Pi`);
              logger.error(`   Available at build: ${freshAvailableBalance.toFixed(7)} Pi`);
              logger.error(`   Payment amount: ${platformFeeNum.toFixed(7)} Pi`);
              logger.error(`   Transaction fee: ${transactionFeeNum.toFixed(7)} Pi`);
              logger.error(`   Total needed: ${totalRequired.toFixed(7)} Pi`);
              logger.error(`   This suggests the account balance may have changed or there's a reserve calculation mismatch`);
            }
          }
          logger.error(`Full error:`, JSON.stringify(errorData, null, 2));
        } else {
          logger.error(`Error: ${feeError.message}`);
        }
        throw feeError;
      }

      // Transaction 2: Issuer sends tokens to distributor
      logger.info(`🔹 Step 2: Issuer sends tokens to distributor`);
      
      // Reload issuer account right before building to ensure fresh sequence number
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
      logger.info(`✅ Token payment: ${totalSupply} ${assetCode} from ${issuerPublicKey} to ${distributorPublicKey}`);

      const tx = tokenTxBuilder.setTimeout(300).build(); // Increased timeout to 5 minutes to avoid tx_too_late
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
        logger.error(`🔴 Transaction submission failed`);
        if (submitError.response?.data) {
          const errorData = submitError.response.data;
          if (errorData.extras?.result_codes) {
            logger.error(`Result codes:`, JSON.stringify(errorData.extras.result_codes, null, 2));
            const opErrors = errorData.extras.result_codes?.operations || [];
            if (opErrors.length > 0 && opErrors[0] === 'op_underfunded') {
              logger.error(`🔴 First operation failed with op_underfunded`);
              logger.error(`   This means the distributor account doesn't have enough balance to send ${platformFeeNum.toFixed(7)} Pi`);
              logger.error(`   Account balance at check: ${finalDistributorBalance.toFixed(7)} Pi`);
              logger.error(`   Reserve: ${finalTotalReserve.toFixed(7)} Pi`);
              logger.error(`   Available at check: ${finalAvailableBalance.toFixed(7)} Pi`);
              logger.error(`   Required: ${totalRequired.toFixed(7)} Pi`);
              logger.error(`   Balance may have changed or there may be pending transactions`);
            }
          }
          if (errorData.extras?.envelope_xdr) {
            logger.error(`Transaction XDR available in error response`);
          }
          logger.error(`Full error response:`, JSON.stringify(errorData, null, 2));
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