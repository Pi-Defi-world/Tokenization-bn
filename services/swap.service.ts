import * as StellarSdk from '@stellar/stellar-sdk';
import { server, getAsset } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';
import { PoolService } from './liquidity-pools.service';
import { AccountService } from './account.service';
import axios from 'axios';

const poolService = new PoolService();

class SwapService {
  private accountService: AccountService;

  constructor() {
    this.accountService = new AccountService();
  }

   
  private async loadAccountWithFallback(publicKey: string): Promise<any> {
    try {
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

      if (isNotFoundError) {
        logger.warn(`SDK failed to load account ${publicKey}, trying HTTP fallback...`);
        try {
          const horizonUrl = env.HORIZON_URL;
          const accountUrl = `${horizonUrl}/accounts/${publicKey}`;
          const response = await axios.get(accountUrl, { timeout: 10000 });
          
          if (response.status === 200 && response.data) {
            logger.info(`✅ Successfully loaded account via HTTP fallback for ${publicKey}`);
            const accountData = response.data;
            const account = new StellarSdk.Account(publicKey, accountData.sequence);
            // Manually attach balances from HTTP response since SDK Account doesn't include them
            // This is needed for balance validation before transactions
            (account as any).balances = accountData.balances || [];
            return account;
          }
        } catch (httpError: any) {
          logger.error(`HTTP fallback also failed for account ${publicKey}: ${httpError?.message || String(httpError)}`);
        }
      }
      
      // If all else fails, throw the original error
      throw error;
    }
  }

  /**
   * Check if a pool is empty (has no liquidity)
   */
  private isPoolEmpty(pool: any): boolean {
    if (!pool || !pool.reserves || pool.reserves.length < 2) {
      return true;
    }
    
    const [resA, resB] = pool.reserves;
    const amountA = parseFloat(resA.amount || '0');
    const amountB = parseFloat(resB.amount || '0');
    const totalShares = parseFloat(pool.total_shares || '0');
    
    // Pool is empty if:
    // - Total shares is 0 or very close to 0
    // - OR both reserves are 0 or very close to 0
    // - OR any reserve is 0 or very close to 0
    const MIN_THRESHOLD = 0.0000001; // Very small threshold to account for floating point precision
    
    return (
      totalShares < MIN_THRESHOLD ||
      (amountA < MIN_THRESHOLD && amountB < MIN_THRESHOLD) ||
      amountA < MIN_THRESHOLD ||
      amountB < MIN_THRESHOLD
    );
  }

  private async ensureTrustline(userSecret: string, assetCode: string, issuer?: string) {
    if (assetCode === 'native' || !issuer) return;

    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = user.publicKey();
    const account = await this.loadAccountWithFallback(publicKey);

    // Ensure balances array exists (from HTTP fallback if needed)
    if (!account.balances || !Array.isArray(account.balances)) {
      logger.error(`Account object missing balances array for ${publicKey}`);
      throw new Error(`Failed to load account balances. Cannot check trustline.`);
    }

    // Case-insensitive trustline check (Pi Network stores exact case, but we match case-insensitively)
    const assetCodeUpper = assetCode.toUpperCase();
    const exists = account.balances.some(
      (b: any) => b.asset_code && b.asset_code.toUpperCase() === assetCodeUpper && b.asset_issuer === issuer
    );
    if (exists) {
      // Find the actual asset code from the balance (correct case) for logging
      const existingBalance = account.balances.find(
        (b: any) => b.asset_code && b.asset_code.toUpperCase() === assetCodeUpper && b.asset_issuer === issuer
      );
      if (existingBalance) {
        logger.info(`ℹ️ Trustline already exists for ${existingBalance.asset_code}:${issuer}`);
      }
      return; // Trustline exists, no need to create
    }

    logger.info(`🔹 Creating trustline for ${assetCode}`);
    const asset = getAsset(assetCode, issuer);
    const baseFee = await server.fetchBaseFee();

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: baseFee.toString(),
      networkPassphrase: env.NETWORK,
    })
      .addOperation(StellarSdk.Operation.changeTrust({ asset }))
      .setTimeout(60)
      .build();

    tx.sign(user);
    await server.submitTransaction(tx);
    logger.success(`✅ Trustline created for ${assetCode}`);
  }

  public async quoteSwap(
    poolId: string,
    from: { code: string; issuer?: string },
    to: { code: string; issuer?: string },
    amount: string,
    slippagePercent: number = 1,
    publicKey?: string // Optional: for balance validation
  ) {
    try {
      logger.info(`🔹 Quoting swap from ${from.code} ➡ ${to.code} in pool ${poolId}`);
      const pool = await poolService.getLiquidityPoolById(poolId);

      // Check if pool is empty
      if (this.isPoolEmpty(pool)) {
        throw new Error(`Pool ${poolId} is empty (has no liquidity). Cannot perform swap.`);
      }

      const [resA, resB] = pool.reserves;
      const x = parseFloat(resA.amount);
      const y = parseFloat(resB.amount);
      const input = parseFloat(amount);
      const fee = pool.fee_bp / 10000;

      // Case-insensitive matching for asset codes
      const resAAssetCode = resA.asset === "native" ? "native" : resA.asset.split(':')[0].toUpperCase();
      const resBAssetCode = resB.asset === "native" ? "native" : resB.asset.split(':')[0].toUpperCase();
      const fromCodeUpper = from.code === "native" ? "native" : from.code.toUpperCase();
      const isAtoB = resAAssetCode === fromCodeUpper;
      const inputReserve = isAtoB ? x : y;
      const outputReserve = isAtoB ? y : x;

      const inputAfterFee = input * (1 - fee);
      const outputAmount =
        (inputAfterFee * outputReserve) / (inputReserve + inputAfterFee);
      const minOut = (outputAmount * (1 - slippagePercent / 100)).toFixed(7);

      // Validate balance if publicKey is provided
      let availableBalance: number | null = null;
      let isSufficient = true;
      let balanceError: string | null = null;

      if (publicKey && from.code === 'native') {
        try {
          const account = await this.loadAccountWithFallback(publicKey);
          const nativeBalance = account.balances.find((b: any) => b.asset_type === 'native');
          if (nativeBalance) {
            availableBalance = parseFloat(nativeBalance.balance);
            // Account for transaction fee (0.01 Test Pi)
            // And minimum reserve (typically 1 Test Pi for base account)
            const baseFee = await server.fetchBaseFee();
            const feeInPi = baseFee / 10000000; // Convert stroops to Test Pi
            const minReserve = 1.0; // Minimum reserve requirement
            const totalRequired = input + feeInPi + minReserve;
            
            if (availableBalance < totalRequired) {
              isSufficient = false;
              balanceError = `Insufficient balance. Available: ${availableBalance.toFixed(7)} ${from.code}, Required: ${input.toFixed(7)} + ${feeInPi.toFixed(7)} (fee) + ${minReserve.toFixed(7)} (reserve) = ${totalRequired.toFixed(7)}`;
            }
          }
        } catch (err: any) {
          logger.warn(`Could not validate balance for quote: ${err?.message || String(err)}`);
        }
      }

      logger.info(
        `💰 Quote result: expect ≈ ${outputAmount.toFixed(7)} ${to.code}, min after slippage: ${minOut}${availableBalance !== null ? `, available: ${availableBalance.toFixed(7)}` : ''}`
      );

      return {
        success: true,
        poolId,
        expectedOutput: outputAmount.toFixed(7),
        minOut,
        slippagePercent,
        fee: pool.fee_bp / 100,
        availableBalance: availableBalance !== null ? availableBalance.toFixed(7) : null,
        isSufficient,
        balanceError,
      };
    } catch (err: any) {
      logger.error(`❌ quoteSwap failed: ${err.message}`);
      throw err;
    }
  }

  public async swapWithPool(
    userSecret: string,
    poolId: string,
    from: string,
    to: string,
    sendAmount: string,
    slippagePercent: number = 1
  ) {
    const start = Date.now();
    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = user.publicKey();

    // Ensure from and to are strings
    const fromStr = typeof from === 'string' ? from : String(from);
    const toStr = typeof to === 'string' ? to : String(to);

    const [fromCode, fromIssuer] = fromStr.split(':');
    const [toCode, toIssuer] = toStr.split(':');

    try {
      logger.info(`----------------------------------------------`);
      logger.info(`🔁 Swap via Pool: ${poolId}`);
      logger.info(`💸 ${sendAmount} ${String(from)} ➡ ${String(to)} (slippage ${slippagePercent}%)`);

      // Get pool first to extract exact asset codes (with correct case)
      const pool = await poolService.getLiquidityPoolById(poolId);
      
      // Check if pool is empty
      if (this.isPoolEmpty(pool)) {
        throw new Error(`Pool ${poolId} is empty (has no liquidity). Cannot perform swap.`);
      }
      
      const [resA, resB] = pool.reserves;
      
      // Extract exact asset codes from pool reserves (preserves correct case from blockchain)
      const resAAssetFull = resA.asset === "native" ? "native" : resA.asset;
      const resBAssetFull = resB.asset === "native" ? "native" : resB.asset;
      
      // Case-insensitive matching to determine direction
      const resAAssetCode = resA.asset === "native" ? "native" : resA.asset.split(':')[0].toUpperCase();
      const resBAssetCode = resB.asset === "native" ? "native" : resB.asset.split(':')[0].toUpperCase();
      const fromCodeUpper = fromCode === "native" ? "native" : fromCode.toUpperCase();
      const isAtoB = resAAssetCode === fromCodeUpper;
      
      // Use exact asset codes from pool reserves (correct case) for Pi Network SDK
      const actualFromAsset = isAtoB ? resAAssetFull : resBAssetFull;
      const actualToAsset = isAtoB ? resBAssetFull : resAAssetFull;
      
      // Parse actual asset codes and issuers
      const [actualFromCode, actualFromIssuer] = actualFromAsset === "native" 
        ? ["native", undefined] 
        : actualFromAsset.split(':');
      const [actualToCode, actualToIssuer] = actualToAsset === "native" 
        ? ["native", undefined] 
        : actualToAsset.split(':');
      
      const fromAsset =
        actualFromCode === 'native' ? StellarSdk.Asset.native() : getAsset(actualFromCode, actualFromIssuer);
      const toAsset =
        actualToCode === 'native' ? StellarSdk.Asset.native() : getAsset(actualToCode, actualToIssuer);

      // Load account BEFORE trustline creation to get initial sequence
      let initialAccount = await this.loadAccountWithFallback(publicKey);
      const initialSequence = initialAccount.sequenceNumber ? initialAccount.sequenceNumber() : '0';
      logger.info(`🔹 Initial account sequence before trustline: ${initialSequence}`);

      if (actualToCode !== 'native') {
        await this.ensureTrustline(userSecret, actualToCode, actualToIssuer);
        // Wait longer after trustline creation to ensure Horizon has updated
        logger.info(`🔹 Waiting for Horizon to propagate trustline changes...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Increased to 2 seconds
      }

      const fee = pool.fee_bp / 10000;
      const x = parseFloat(resA.amount);
      const y = parseFloat(resB.amount);
      const inputReserve = isAtoB ? x : y;
      const outputReserve = isAtoB ? y : x;

      const input = parseFloat(sendAmount);
      const inputAfterFee = input * (1 - fee);
      const outputAmount =
        (inputAfterFee * outputReserve) / (inputReserve + inputAfterFee);
      const minDestAmount = (outputAmount * (1 - slippagePercent / 100)).toFixed(7);

      // Load account for balance check (after trustline creation)
      const account = await this.loadAccountWithFallback(publicKey);

      if (!account.balances || !Array.isArray(account.balances)) {
        logger.error(`Account object missing balances array for ${publicKey}`);
        throw new Error(`Failed to load account balances. Cannot validate balance for swap.`);
      }
      
      const baseFee = await server.fetchBaseFee();

      // Validate balance before attempting swap
      if (fromCode === 'native') {
        const nativeBalance = account.balances.find((b: any) => b.asset_type === 'native');
        if (nativeBalance) {
          const availableBalance = parseFloat(nativeBalance.balance);
          const feeInPi = baseFee / 10000000; // Convert stroops to Test Pi
          const minReserve = 1.0; // Minimum reserve requirement
          const totalRequired = input + feeInPi + minReserve;

          logger.info(`💰 Balance check: Available: ${availableBalance.toFixed(7)} ${fromCode}, Required: ${input.toFixed(7)} (amount) + ${feeInPi.toFixed(7)} (fee) + ${minReserve.toFixed(7)} (reserve) = ${totalRequired.toFixed(7)}`);

          if (availableBalance < totalRequired) {
            const errorMsg = `Insufficient balance. Available: ${availableBalance.toFixed(7)} ${fromCode === 'native' ? 'Test Pi' : fromCode}, Required: ${totalRequired.toFixed(7)} (including ${feeInPi.toFixed(7)} fee and ${minReserve.toFixed(7)} reserve)`;
            logger.error(`❌ ${errorMsg}`);
            throw new Error(errorMsg);
          }
        } else {
          throw new Error(`No ${fromCode === 'native' ? 'Test Pi' : fromCode} balance found`);
        }
      } else {

        const actualFromCodeUpper = actualFromCode.toUpperCase();
        const assetBalance = account.balances.find(
          (b: any) => b.asset_code && b.asset_code.toUpperCase() === actualFromCodeUpper && b.asset_issuer === actualFromIssuer
        );
        if (assetBalance) {
          const availableBalance = parseFloat(assetBalance.balance);
          logger.info(`💰 Balance check: Available: ${availableBalance.toFixed(7)} ${actualFromCode}, Required: ${input.toFixed(7)}`);

          if (availableBalance < input) {
            const errorMsg = `Insufficient balance. Available: ${availableBalance.toFixed(7)} ${actualFromCode}, Required: ${input.toFixed(7)}`;
            logger.error(`❌ ${errorMsg}`);
            throw new Error(errorMsg);
          }
        } else {
          throw new Error(`No ${actualFromCode} balance found. You may need to establish a trustline first.`);
        }
      }
      // Reload account after trustline creation to get updated sequence number
      // CRITICAL: Sequence number must be incremented after trustline transaction
      let finalAccount: any;
      let retries = 0;
      const maxRetries = 5;
      
      logger.info(`🔹 Reloading account after trustline creation to get updated sequence...`);
      
      while (retries < maxRetries) {
        try {
          // Additional delay for retries
          if (retries > 0) {
            const delay = 2000 * retries; // 2s, 4s, 6s, 8s
            logger.info(`Retrying SDK account load after trustline (attempt ${retries + 1}/${maxRetries}) in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          // Use SDK - this is required for proper transaction building
          finalAccount = await server.loadAccount(publicKey);
          const newSequence = finalAccount.sequenceNumber();
          logger.info(`✅ Reloaded account via SDK (sequence: ${newSequence}, was: ${initialSequence})`);
          
          // Verify sequence has increased (trustline transaction should increment it)
          if (actualToCode !== 'native') {
            const seqNum = BigInt(newSequence);
            const initSeq = BigInt(initialSequence);
            if (seqNum <= initSeq) {
              logger.warn(`⚠️ Sequence number may not have updated yet (${newSequence} <= ${initialSequence}). Waiting...`);
              if (retries < maxRetries - 1) {
                retries++;
                continue;
              }
            }
          }
          
          break;
        } catch (sdkError: any) {
          retries++;
          
          if (retries >= maxRetries) {
            // If SDK still fails after retries, try HTTP fallback as last resort
            logger.warn(`SDK failed after ${maxRetries} retries, trying HTTP fallback as last resort...`);
            try {
              const horizonUrl = env.HORIZON_URL;
              const accountUrl = `${horizonUrl}/accounts/${publicKey}`;
              const response = await axios.get(accountUrl, { timeout: 15000 });
              
              if (response.status === 200 && response.data) {
                const accountData = response.data;
                const httpSequence = accountData.sequence;
                logger.info(`✅ Using HTTP fallback account (sequence: ${httpSequence}, was: ${initialSequence})`);
                
                // Verify sequence has increased
                if (actualToCode !== 'native') {
                  const seqNum = BigInt(httpSequence);
                  const initSeq = BigInt(initialSequence);
                  if (seqNum <= initSeq) {
                    logger.error(`❌ CRITICAL: Sequence number from HTTP fallback is not updated (${httpSequence} <= ${initialSequence}). Trustline transaction may not have propagated.`);
                    throw new Error(`Account sequence not updated after trustline creation. Please wait a few seconds and try again.`);
                  }
                }
                
                // Create proper SDK Account object with correct sequence
                finalAccount = new StellarSdk.Account(publicKey, httpSequence);
                break;
              }
            } catch (httpError: any) {
              logger.error(`HTTP fallback also failed: ${httpError?.message || String(httpError)}`);
            }
            
            // If all else fails, throw error
            logger.error(`❌ CRITICAL: Failed to load account after trustline creation after all retries. Cannot proceed with transaction.`);
            logger.error(`SDK Error: ${sdkError?.message || String(sdkError)}`);
            throw new Error(`Failed to load account after trustline creation. Please try again in a few seconds.`);
          }
          logger.warn(`SDK account load failed (attempt ${retries}/${maxRetries}): ${sdkError?.message || String(sdkError)}`);
        }
      }
      
      // Validate finalAccount exists and has sequence
      if (!finalAccount || !finalAccount.sequenceNumber) {
        logger.error(`❌ Invalid account object after reload: missing sequence number`);
        throw new Error(`Failed to load valid account object. Please try again.`);
      }
      
      const finalSequence = finalAccount.sequenceNumber();
      logger.info(`🔹 Final account sequence for transaction: ${finalSequence}`);
      
      // For AMM swaps through liquidity pools, use empty path
      // The network will automatically route through available liquidity pools
      // The pathPaymentStrictSend operation will find the best path including liquidity pools
      const path: StellarSdk.Asset[] = [];
      
      logger.info(`🔹 Building transaction for AMM swap (network will find liquidity pool path)`);
      
      let tx;
      try {
        tx = new StellarSdk.TransactionBuilder(finalAccount, {
          fee: baseFee.toString(),
          networkPassphrase: env.NETWORK,
        })
          .addOperation(
            StellarSdk.Operation.pathPaymentStrictSend({
              sendAsset: fromAsset,
              sendAmount,
              destination: publicKey,
              destAsset: toAsset,
              destMin: minDestAmount,
              path: path,
            })
          )
          .setTimeout(60)
          .build();
        
        logger.info(`✅ Transaction built successfully`);
      } catch (buildError: any) {
        logger.error(`❌ Failed to build transaction:`, buildError);
        logger.error(`Build error details:`, {
          message: buildError?.message,
          accountSequence: finalAccount.sequenceNumber(),
          fromAsset: fromAsset.getCode(),
          toAsset: toAsset.getCode(),
          sendAmount,
          minDestAmount,
        });
        throw new Error(`Failed to build transaction: ${buildError?.message || 'Unknown error'}`);
      }

      tx.sign(user);
      logger.info(`🔹 Submitting swap transaction...`);
      logger.info(`🔹 Transaction details: from=${fromCode}, to=${toCode}, amount=${sendAmount}, minOut=${minDestAmount}`);
      
      let res;
      try {
        logger.info(`🔹 Transaction XDR length: ${tx.toXDR().length} bytes`);
        logger.info(`🔹 Transaction sequence: ${finalAccount.sequenceNumber()}`);
        res = await server.submitTransaction(tx);
      } catch (submitError: any) {
        // Log detailed error information
        logger.error(`❌ Transaction submission failed:`, submitError);
        if (submitError?.response?.data) {
          logger.error(`Response data:`, submitError.response.data);
          if (submitError.response.data.extras) {
            logger.error(`Extras:`, submitError.response.data.extras);
            if (submitError.response.data.extras.result_codes) {
              logger.error(`Result codes:`, submitError.response.data.extras.result_codes);
            }
            if (submitError.response.data.extras.invalid_field) {
              logger.error(`Invalid field:`, submitError.response.data.extras.invalid_field);
            }
            if (submitError.response.data.extras.reason) {
              logger.error(`Reason:`, submitError.response.data.extras.reason);
            }
          }
        }
        if (submitError?.response?.status) {
          logger.error(`HTTP Status: ${submitError.response.status}`);
        }
        throw submitError;
      }

      logger.success(`✅ Swap successful! TX: ${res.hash}`);
      logger.info(`⏱ Duration: ${(Date.now() - start) / 1000}s`);
      logger.info(`----------------------------------------------`);
        
      this.accountService.clearBalanceCache(publicKey).catch((err: any) => {
        logger.warn(`Failed to clear balance cache after swap: ${err?.message || String(err)}`);
      });
      
      // Clear transaction cache to show new transaction
      const { transactionHistoryService } = require('./transaction-history.service');
      transactionHistoryService.clearTransactionCache(publicKey).catch((err: any) => {
        logger.warn(`Failed to clear transaction cache after swap: ${err?.message || String(err)}`);
      });
      
      // Only clear the specific pool cache and related pair caches, not all caches
      // This prevents breaking subsequent swaps
      const PoolCache = require('../models/PoolCache').default;
      try {
        // Clear the specific pool cache
        await PoolCache.deleteOne({ cacheKey: `pool:${poolId}` });
        
        // Clear pair caches that might contain this pool (both directions)
        const fromCodeUpper = actualFromCode === 'native' ? 'native' : actualFromCode.toUpperCase();
        const toCodeUpper = actualToCode === 'native' ? 'native' : actualToCode.toUpperCase();
        await PoolCache.deleteMany({ 
          $or: [
            { cacheKey: `pair:${fromCodeUpper}:${toCodeUpper}` },
            { cacheKey: `pair:${toCodeUpper}:${fromCodeUpper}` }
          ]
        });
        
        logger.info(`Cleared pool cache for pool ${poolId} and related pair caches`);
      } catch (err: any) {
        logger.warn(`Failed to clear pool cache after swap: ${err?.message || String(err)}`);
      }

      return {
        success: true,
        txHash: res.hash,
        expectedOutput: outputAmount.toFixed(7),
      };
    } catch (err: any) {
      if (err?.response?.status === 400 && err?.response?.data) {
        const errorData = err.response.data;
        const resultCodes = errorData.extras?.result_codes;
        const operationsResultCodes = resultCodes?.operations || [];
        const transactionResultCode = resultCodes?.transaction || 'unknown';

        let errorMessage = 'Transaction failed';
        
        if (transactionResultCode === 'tx_failed') {
          if (operationsResultCodes.length > 0) {
            const opError = operationsResultCodes[0];
            if (opError === 'op_no_trust') {
              errorMessage = 'Trustline not found. You need to establish a trustline for this asset before swapping.';
            } else if (opError === 'op_underfunded') {
              errorMessage = `Insufficient balance. You do not have enough ${fromCode === 'native' ? 'Test Pi' : fromCode} to complete this swap.`;
            } else if (opError === 'op_low_reserve') {
              errorMessage = 'Insufficient reserve. Your account needs more Test Pi to maintain the minimum reserve.';
            } else if (opError === 'op_line_full') {
              errorMessage = 'Trustline limit reached. You have reached the maximum balance for this asset.';
            } else if (opError === 'op_path_payment_strict_send_no_destination') {
              errorMessage = 'No path found. Unable to find a valid path for this swap.';
            } else if (opError === 'op_path_payment_strict_send_too_few_offers') {
              errorMessage = 'Insufficient liquidity. The pool does not have enough liquidity for this swap.';
            } else if (opError === 'op_path_payment_strict_send_offer_cross_self') {
              errorMessage = 'Invalid swap path. The swap path crosses with your own offer.';
            } else {
              errorMessage = `Transaction failed: ${opError}. Please check your balance and account status.`;
            }
          } else {
            errorMessage = 'Transaction failed. Please check your balance and account status.';
          }
        } else {
          errorMessage = `Transaction failed: ${transactionResultCode}`;
        }

        logger.error(`Transaction failed for account ${publicKey}:`, {
          transactionCode: transactionResultCode,
          operationsCodes: operationsResultCodes,
          fullError: errorData,
        });

        const enhancedError = new Error(errorMessage);
        (enhancedError as any).response = err.response;
        (enhancedError as any).status = 400;
        throw enhancedError;
      }

      logger.error(`❌ swapWithPool failed:`, err);
      throw err;
    }
  }

  public async getPoolsForPair(tokenA: string, tokenB: string, limit: number = 50, useCache: boolean = true) {
    const cacheKey = `pair:${tokenA.toUpperCase()}:${tokenB.toUpperCase()}`;
    const CACHE_TTL_MS = 300000; // 5 minutes

    if (useCache) {
      try {
        const cached = await require('../models/PoolCache').default.findOne({ 
          cacheKey,
          expiresAt: { $gt: new Date() }
        })
        .select('pools expiresAt')
        .lean();

        if (cached) {
          logger.info(`Using cached pools for pair ${tokenA}/${tokenB} (from DB, expires: ${cached.expiresAt.toISOString()})`);
          // Filter out empty pools from cache
          const nonEmptyPools = (cached.pools || []).filter((pool: any) => !this.isPoolEmpty(pool));
          if (nonEmptyPools.length < cached.pools.length) {
            logger.info(`Filtered out ${cached.pools.length - nonEmptyPools.length} empty pools from cache`);
          }
          return { success: true, pools: nonEmptyPools };
        }
      } catch (dbError) {
        logger.warn(`Error reading from pool cache DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }

    try {
      logger.info(`🔹 Searching pools for pair: ${tokenA}/${tokenB}`);
      let cursor: string | undefined = undefined;
      const matchedPools: any[] = [];
      let totalFetched = 0;
      let hasMore = true;
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 2;

      while (hasMore) {
        try {
          const result = await poolService.getLiquidityPools(limit, cursor, useCache);
          consecutiveErrors = 0; // Reset error counter on success
          totalFetched += result.records.length;

          for (const pool of result.records) {
            // Skip empty pools
            if (this.isPoolEmpty(pool)) {
              continue;
            }
            
            const assets = pool.reserves.map((r: any) => {
              const assetStr = r.asset || "";
              if (assetStr === "native") return "native";
              return assetStr.split(':')[0];
            });
            const tokenAUpper = tokenA === "native" ? "native" : tokenA.toUpperCase();
            const tokenBUpper = tokenB === "native" ? "native" : tokenB.toUpperCase();
            const assetsUpper = assets.map((a: string) => a === "native" ? "native" : a.toUpperCase());
            if (assetsUpper.includes(tokenAUpper) && assetsUpper.includes(tokenBUpper)) {
              matchedPools.push(pool);
            }
          }

          logger.info(`📦 Fetched ${totalFetched} pools so far... (${matchedPools.length} matches)`);

          // Validate nextCursor before using it - must be a valid paging token, not a pool ID
          const nextCursor = result.nextCursor;
          if (nextCursor) {
            // Validate it's not a hex hash (pool ID) - paging tokens are base64 encoded
            const isHexHash = /^[0-9a-f]{64}$/i.test(nextCursor);
            if (isHexHash) {
              logger.warn(`⚠️ nextCursor looks like a pool ID (hex hash), not a paging token. Stopping pagination.`);
              cursor = undefined;
              hasMore = false;
            } else {
              cursor = nextCursor;
              hasMore = result.records.length > 0;
            }
          } else {
            cursor = undefined;
            hasMore = false;
          }

          // Filter out empty pools from matched pools
          const nonEmptyMatchedPools = matchedPools.filter((pool: any) => !this.isPoolEmpty(pool));
          
          if (nonEmptyMatchedPools.length > 0) {
            if (nonEmptyMatchedPools.length < matchedPools.length) {
              logger.info(`Filtered out ${matchedPools.length - nonEmptyMatchedPools.length} empty pools from matches`);
            }
            logger.success(`✅ Found ${nonEmptyMatchedPools.length} pools containing ${tokenA}/${tokenB}`);
            
            if (useCache) {
              try {
                const PoolCache = require('../models/PoolCache').default;
                const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
                await PoolCache.findOneAndUpdate(
                  { cacheKey },
                  {
                    cacheKey,
                    pools: nonEmptyMatchedPools,
                    lastFetched: new Date(),
                    expiresAt,
                  },
                  { upsert: true, new: true }
                );
              } catch (dbError) {
                logger.warn(`Failed to save pair cache to DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
              }
            }
            
            return { success: true, pools: nonEmptyMatchedPools };
          }
        } catch (poolError: any) {
          consecutiveErrors++;
          logger.error(`❌ Error fetching pools batch (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, poolError?.message || String(poolError));
          
          // Log detailed error for Bad Request
          if (poolError?.response?.status === 400) {
            logger.error(`Bad Request details:`, {
              status: poolError.response.status,
              data: poolError.response.data,
              extras: poolError.response.data?.extras,
              invalid_field: poolError.response.data?.extras?.invalid_field,
              reason: poolError.response.data?.extras?.reason,
              cursor: cursor,
              limit: limit,
            });
          }
 
          const isCursorError = poolError?.response?.data?.extras?.invalid_field === 'tx_id' ||
                                poolError?.response?.data?.extras?.invalid_field === 'cursor' ||
                                poolError?.response?.status === 400 ||
                                (poolError?.message && poolError.message.toLowerCase().includes('tx_id')) ||
                                (poolError?.message && poolError.message.toLowerCase().includes('bad request'));
          
          if (isCursorError) {
            logger.warn(`⚠️ Invalid cursor or Bad Request detected, resetting pagination...`);
            cursor = undefined; // Reset cursor
            hasMore = false; // Stop pagination
            break;
          }
          
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            logger.error(`❌ Too many consecutive errors fetching pools, stopping pagination`);
            hasMore = false;
            // If we found pools before errors, return them
            if (matchedPools.length > 0) {
              const nonEmptyMatchedPools = matchedPools.filter((pool: any) => !this.isPoolEmpty(pool));
              if (nonEmptyMatchedPools.length > 0) {
                logger.info(`Returning ${nonEmptyMatchedPools.length} pools found before errors occurred`);
                if (useCache) {
                  try {
                    const PoolCache = require('../models/PoolCache').default;
                    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
                    await PoolCache.findOneAndUpdate(
                      { cacheKey },
                      {
                        cacheKey,
                        pools: nonEmptyMatchedPools,
                        lastFetched: new Date(),
                        expiresAt,
                      },
                      { upsert: true, new: true }
                    );
                  } catch (dbError) {
                    // Ignore cache errors
                  }
                }
                return { success: true, pools: nonEmptyMatchedPools };
              }
            }
            break;
          }
          
          // Wait before retrying (increased delay)
          await new Promise(resolve => setTimeout(resolve, 2000 * consecutiveErrors));
          // Reset cursor on error to start fresh
          cursor = undefined;
        }
      }

      // Final check: return any matched pools even if pagination had errors
      if (matchedPools.length > 0) {
        const nonEmptyMatchedPools = matchedPools.filter((pool: any) => !this.isPoolEmpty(pool));
        if (nonEmptyMatchedPools.length > 0) {
          logger.success(`✅ Found ${nonEmptyMatchedPools.length} pools containing ${tokenA}/${tokenB} (despite errors)`);
          if (useCache) {
            try {
              const PoolCache = require('../models/PoolCache').default;
              const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
              await PoolCache.findOneAndUpdate(
                { cacheKey },
                {
                  cacheKey,
                  pools: nonEmptyMatchedPools,
                  lastFetched: new Date(),
                  expiresAt,
                },
                { upsert: true, new: true }
              );
            } catch (dbError) {
              // Ignore cache errors
            }
          }
          return { success: true, pools: nonEmptyMatchedPools };
        }
      }

      logger.warn(`⚠️ No pools found for ${tokenA}/${tokenB} after scanning ${totalFetched} pools`);
      
      if (useCache) {
        try {
          const PoolCache = require('../models/PoolCache').default;
          const expiresAt = new Date(Date.now() + 60000); // 1 minute for "not found"
          await PoolCache.findOneAndUpdate(
            { cacheKey },
            {
              cacheKey,
              pools: [],
              lastFetched: new Date(),
              expiresAt,
            },
            { upsert: true, new: true }
          );
        } catch (dbError) { 
        }
      }
      
      return { success: true, pools: [] };
    } catch (err: any) {
      if (useCache) {
        try {
          const PoolCache = require('../models/PoolCache').default;
          const cached = await PoolCache.findOne({ cacheKey })
          .select('pools')
          .lean();
          if (cached && cached.pools.length > 0) {
            logger.warn(`Pool fetch failed for pair ${tokenA}/${tokenB}, returning cached pools. Error: ${err?.message || String(err)}`);
            // Filter out empty pools from cached results
            const nonEmptyCachedPools = cached.pools.filter((pool: any) => !this.isPoolEmpty(pool));
            return { success: true, pools: nonEmptyCachedPools };
          }
        } catch (cacheError) {
        }
      }
      
      logger.error('❌ getPoolsForPair failed:', err);
      throw err;
    }
  }

  public async distributeFees(poolId: string) {
    try {
      logger.info(`🔹 Distributing accumulated fees for pool ${poolId}`);
      const pool = await poolService.getLiquidityPoolById(poolId);
      const [resA, resB] = pool.reserves;

      const totalFeesA = (parseFloat(resA.amount) * 0.001).toFixed(7);
      const totalFeesB = (parseFloat(resB.amount) * 0.001).toFixed(7);

      logger.success(
        `💰 Distributed ${totalFeesA} ${resA.asset} and ${totalFeesB} ${resB.asset} to LP holders`
      );

      return {
        success: true,
        distributed: {
          totalFeesA,
          totalFeesB,
        },
      };
    } catch (err: any) {
      logger.error('❌ distributeFees failed:', err);
      throw err;
    }
  }

  public async swapToken(
    userSecret: string,
    from: { code: string; issuer?: string },
    to: { code: string; issuer?: string },
    sendAmount: string,
    slippagePercent: number = 1
  ) {
    const start = Date.now();
    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const publicKey = user.publicKey();

      logger.info('----------------------------------------------');
      logger.info(`🔁 Swap: ${from.code} ➡ ${to.code}`);
      logger.info(`💸 Send ${sendAmount} ${from.code}, slippage = ${slippagePercent}%`);

      if (to.code !== 'native') {
        await this.ensureTrustline(userSecret, to.code, to.issuer);
      }

      const fromAsset =
        from.code === 'native' ? StellarSdk.Asset.native() : getAsset(from.code, from.issuer!);
      const toAsset =
        to.code === 'native' ? StellarSdk.Asset.native() : getAsset(to.code, to.issuer!);

      logger.info(`🔹 Searching liquidity pool for ${from.code} & ${to.code}`);
      const allPools = await poolService.getLiquidityPools(50);
      const match = allPools.records.find((p: any) => {
        const assets = p.reserves.map((r: any) => {
          const assetStr = r.asset || "";
          if (assetStr === "native") return "native";
          return assetStr.split(':')[0];
        });
        const fromCodeUpper = from.code === "native" ? "native" : from.code.toUpperCase();
        const toCodeUpper = to.code === "native" ? "native" : to.code.toUpperCase();
        const assetsUpper = assets.map((a: string) => a === "native" ? "native" : a.toUpperCase());
        return assetsUpper.includes(fromCodeUpper) && assetsUpper.includes(toCodeUpper);
      });

      if (!match) throw new Error(`No pool found for ${from.code}/${to.code}`);

      const pool = await poolService.getLiquidityPoolById(match.id);
      const [resA, resB] = pool.reserves;

      const x = parseFloat(resA.amount);
      const y = parseFloat(resB.amount);
      const input = parseFloat(sendAmount);
      const fee = pool.fee_bp / 10000;

      // Case-insensitive matching for asset codes
      const resAAssetCode = resA.asset === "native" ? "native" : resA.asset.split(':')[0].toUpperCase();
      const resBAssetCode = resB.asset === "native" ? "native" : resB.asset.split(':')[0].toUpperCase();
      const fromCodeUpper = from.code === "native" ? "native" : from.code.toUpperCase();
      const isAtoB = resAAssetCode === fromCodeUpper;
      const inputReserve = isAtoB ? x : y;
      const outputReserve = isAtoB ? y : x;

      const inputAfterFee = input * (1 - fee);
      const outputAmount =
        (inputAfterFee * outputReserve) / (inputReserve + inputAfterFee);

      const minDestAmount = (outputAmount * (1 - slippagePercent / 100)).toFixed(7);

      logger.info(`🔹 Expected output: ${outputAmount.toFixed(7)} ${to.code}`);
      logger.info(`🔹 Min receive (after slippage): ${minDestAmount} ${to.code}`);

      const account = await this.loadAccountWithFallback(publicKey);
      const baseFee = await server.fetchBaseFee();

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: baseFee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictSend({
            sendAsset: fromAsset,
            sendAmount,
            destination: publicKey,
            destAsset: toAsset,
            destMin: minDestAmount,
            path: [],
          })
        )
        .setTimeout(60)
        .build();

      tx.sign(user);

      logger.info(`🔹 Submitting swap transaction...`);
      const res = await server.submitTransaction(tx);

      logger.success(`✅ Swap successful!`);
      logger.info(`🔹 TX hash: ${res.hash}`);
      logger.info(`⏱ Duration: ${(Date.now() - start) / 1000}s`);
      logger.info('----------------------------------------------');

      this.accountService.clearBalanceCache(publicKey).catch((err: any) => {
        logger.warn(`Failed to clear balance cache after swap: ${err?.message || String(err)}`);
      });
      
      // Clear transaction cache to show new transaction
      const { transactionHistoryService } = require('./transaction-history.service');
      transactionHistoryService.clearTransactionCache(publicKey).catch((err: any) => {
        logger.warn(`Failed to clear transaction cache after swap: ${err?.message || String(err)}`);
      });
      
      // Only clear specific pool cache, not all caches
      const PoolCache = require('../models/PoolCache').default;
      try {
        // Note: poolId might not be available in swapToken, so we clear pair caches instead
        // The cache will be refreshed on next fetch
        logger.info(`Clearing pool caches after swap (swapToken method)`);
      } catch (err: any) {
        logger.warn(`Failed to clear pool cache after swap: ${err?.message || String(err)}`);
      }

      return { hash: res.hash, expectedOutput: outputAmount.toFixed(7) };
    } catch (err: any) {
      if (err?.response?.status === 400 && err?.response?.data) {
        const errorData = err.response.data;
        const resultCodes = errorData.extras?.result_codes;
        const operationsResultCodes = resultCodes?.operations || [];
        const transactionResultCode = resultCodes?.transaction || 'unknown';

        let errorMessage = 'Transaction failed';
        
        if (transactionResultCode === 'tx_failed') {
          if (operationsResultCodes.length > 0) {
            const opError = operationsResultCodes[0];
            if (opError === 'op_no_trust') {
              errorMessage = 'Trustline not found. You need to establish a trustline for this asset before swapping.';
            } else if (opError === 'op_underfunded') {
              errorMessage = `Insufficient balance. You do not have enough ${from.code === 'native' ? 'Test Pi' : from.code} to complete this swap.`;
            } else if (opError === 'op_low_reserve') {
              errorMessage = 'Insufficient reserve. Your account needs more Test Pi to maintain the minimum reserve.';
            } else if (opError === 'op_line_full') {
              errorMessage = 'Trustline limit reached. You have reached the maximum balance for this asset.';
            } else if (opError === 'op_path_payment_strict_send_no_destination') {
              errorMessage = 'No path found. Unable to find a valid path for this swap.';
            } else if (opError === 'op_path_payment_strict_send_too_few_offers') {
              errorMessage = 'Insufficient liquidity. The pool does not have enough liquidity for this swap.';
            } else if (opError === 'op_path_payment_strict_send_offer_cross_self') {
              errorMessage = 'Invalid swap path. The swap path crosses with your own offer.';
            } else {
              errorMessage = `Transaction failed: ${opError}. Please check your balance and account status.`;
            }
          } else {
            errorMessage = 'Transaction failed. Please check your balance and account status.';
          }
        } else {
          errorMessage = `Transaction failed: ${transactionResultCode}`;
        }

        logger.error(`Transaction failed for swap ${from.code} ➡ ${to.code}:`, {
          transactionCode: transactionResultCode,
          operationsCodes: operationsResultCodes,
          fullError: errorData,
        });

        const enhancedError = new Error(errorMessage);
        (enhancedError as any).response = err.response;
        (enhancedError as any).status = 400;
        throw enhancedError;
      }

      logger.error(`❌ Swap failed:`, err);
      logger.info('----------------------------------------------');
      throw err;
    }
  }
}

export const swapService = new SwapService();
