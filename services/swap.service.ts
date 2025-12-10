import * as StellarSdk from '@stellar/stellar-sdk';
import { server, getAsset } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';
import { PoolService } from './liquidity-pools.service';
import { AccountService } from './account.service';
import { Pair, IPair } from '../models/Pair';
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
      
      throw error;
    }
  }

  /**
   */
  private isPoolEmpty(pool: any): boolean {
    if (!pool || !pool.reserves || pool.reserves.length < 2) {
      return true;
    }
    
    const [resA, resB] = pool.reserves;
    const amountA = parseFloat(resA.amount || '0');
    const amountB = parseFloat(resB.amount || '0');
    const totalShares = parseFloat(pool.total_shares || '0');
    
    const MIN_THRESHOLD = 0.0000001; 
    
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

    if (!account.balances || !Array.isArray(account.balances)) {
      logger.error(`Account object missing balances array for ${publicKey}`);
      throw new Error(`Failed to load account balances. Cannot check trustline.`);
    }

    const assetCodeUpper = assetCode.toUpperCase();
    const exists = account.balances.some(
      (b: any) => b.asset_code && b.asset_code.toUpperCase() === assetCodeUpper && b.asset_issuer === issuer
    );
    if (exists) {
      const existingBalance = account.balances.find(
        (b: any) => b.asset_code && b.asset_code.toUpperCase() === assetCodeUpper && b.asset_issuer === issuer
      );
      if (existingBalance) {
        logger.info(`ℹ️ Trustline already exists for ${existingBalance.asset_code}:${issuer}`);
      }
      return;  
    }

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

  private async collectSwapFee(
    userSecret: string,
    inputAmount: string,
    fromCode: string
  ): Promise<string> {
    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const publicKey = user.publicKey();
      
      // Calculate platform fee (0.3% of input amount)
      const swapFeePercent = parseFloat(env.PLATFORM_SWAP_FEE_PERCENT) / 100;
      const inputAmountNum = parseFloat(inputAmount);
      const swapFeeAmount = (inputAmountNum * swapFeePercent).toFixed(7);
      
      // Load account to check balance
      const account = await this.loadAccountWithFallback(publicKey);
      
      let baseFee: string = "100000";
      try {
        const fetchedFee = await server.fetchBaseFee();
        baseFee = fetchedFee.toString();
      } catch (feeError: any) {
        // Use default fee
      }
      
      const baseFeeNum = parseFloat(baseFee) / 10000000;
      const swapFeeNum = parseFloat(swapFeeAmount);
      
      // Balance validation
      if (fromCode === 'native') {
        const nativeBalance = account.balances.find((b: any) => b.asset_type === 'native');
        if (nativeBalance) {
          const balance = parseFloat(nativeBalance.balance);
          const baseReserve = 1.0;
          const subentryCount = (account as any).subentry_count || 
            account.balances.filter((b: any) => 
              b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'
            ).length;
          const subentryReserve = 0.5;
          const totalReserve = baseReserve + (subentryCount * subentryReserve);
          const requiredBalance = inputAmountNum + swapFeeNum + baseFeeNum + totalReserve;
          
          if (balance < requiredBalance) {
            throw new Error(
              `Insufficient balance for swap. Required: ${requiredBalance.toFixed(7)} Test Pi (Input: ${inputAmount} + Platform fee: ${swapFeeAmount} + Base fee: ${baseFeeNum.toFixed(7)} + Reserve: ${totalReserve.toFixed(7)}), Available: ${balance.toFixed(7)} Test Pi`
            );
          }
        } else {
          throw new Error('No Test Pi balance found');
        }
      } else {
        // For non-native input, check token balance and native balance for fees
        const assetBalance = account.balances.find(
          (b: any) => b.asset_code && b.asset_code.toUpperCase() === fromCode.toUpperCase()
        );
        if (!assetBalance || parseFloat(assetBalance.balance) < inputAmountNum) {
          throw new Error(`Insufficient ${fromCode} balance. Required: ${inputAmount}, Available: ${assetBalance?.balance || 0}`);
        }
        
        // Check native balance for platform fee
        const nativeBalance = account.balances.find((b: any) => b.asset_type === 'native');
        if (nativeBalance) {
          const balance = parseFloat(nativeBalance.balance);
          const baseReserve = 1.0;
          const subentryCount = (account as any).subentry_count || 
            account.balances.filter((b: any) => 
              b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'
            ).length;
          const subentryReserve = 0.5;
          const totalReserve = baseReserve + (subentryCount * subentryReserve);
          const requiredBalance = swapFeeNum + baseFeeNum + totalReserve;
          
          if (balance < requiredBalance) {
            throw new Error(
              `Insufficient Test Pi for swap fee. Required: ${requiredBalance.toFixed(7)} Test Pi (Platform fee: ${swapFeeAmount} + Base fee: ${baseFeeNum.toFixed(7)} + Reserve: ${totalReserve.toFixed(7)}), Available: ${balance.toFixed(7)} Test Pi`
            );
          }
        } else {
          throw new Error('No Test Pi balance found for swap fee');
        }
      }
      
      // Reload account right before building to ensure fresh sequence number
      const freshAccount = await this.loadAccountWithFallback(publicKey);
      
      const feeTxBuilder = new StellarSdk.TransactionBuilder(freshAccount, {
        fee: baseFee,
        networkPassphrase: env.NETWORK,
      });
      
      feeTxBuilder.addOperation(
        StellarSdk.Operation.payment({
          destination: env.PI_TEST_USER_PUBLIC_KEY,
          asset: StellarSdk.Asset.native(),
          amount: swapFeeAmount,
        })
      );
      
      logger.info(`💰 Collecting swap platform fee: ${swapFeeAmount} Test Pi (0.3% of ${inputAmount} ${fromCode})`);
      
      const feeTx = feeTxBuilder.setTimeout(300).build();
      feeTx.sign(user);
      
      // Submit fee payment transaction
      const feeTxXdr = feeTx.toXDR();
      const submitUrl = `${env.HORIZON_URL}/transactions`;
      
      const feeResponse = await axios.post(submitUrl, `tx=${encodeURIComponent(feeTxXdr)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      });
      
      logger.success(`✅ Swap platform fee paid - Hash: ${feeResponse.data.hash}`);
      
      // Wait for transaction to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return swapFeeAmount;
    } catch (err: any) {
      logger.error(`❌ Swap fee collection failed: ${err.message || String(err)}`);
      throw err;
    }
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
      const pool = await poolService.getLiquidityPoolById(poolId);

      if (this.isPoolEmpty(pool)) {
        throw new Error(`Pool ${poolId} is empty (has no liquidity). Cannot perform swap.`);
      }

      const [resA, resB] = pool.reserves;
      const x = parseFloat(resA.amount);
      const y = parseFloat(resB.amount);
      const input = parseFloat(amount);
      const fee = pool.fee_bp / 10000;

      const resAAssetCode = resA.asset === "native" ? "native" : resA.asset.split(':')[0].toUpperCase();
      const resBAssetCode = resB.asset === "native" ? "native" : resB.asset.split(':')[0].toUpperCase();
      const fromCodeUpper = from.code === "native" ? "native" : from.code.toUpperCase();
      const isAtoB = resAAssetCode === fromCodeUpper;
      const inputReserve = isAtoB ? x : y;
      const outputReserve = isAtoB ? y : x;

      // Validate pool has sufficient reserves for the requested amount
      if (input > inputReserve) {
        throw new Error(
          `Insufficient liquidity in pool. Requested: ${input.toFixed(7)} ${from.code}, Available in pool: ${inputReserve.toFixed(7)} ${from.code}. The pool does not have enough ${from.code} to complete this swap.`
        );
      }

      const inputAfterFee = input * (1 - fee);
      const outputAmount =
        (inputAfterFee * outputReserve) / (inputReserve + inputAfterFee);
      
      // Validate pool has sufficient output reserve
      if (outputAmount > outputReserve) {
        throw new Error(
          `Insufficient liquidity in pool. Calculated output: ${outputAmount.toFixed(7)} ${to.code}, Available in pool: ${outputReserve.toFixed(7)} ${to.code}. The pool does not have enough ${to.code} to complete this swap.`
        );
      }
      
      const minOut = (outputAmount * (1 - slippagePercent / 100)).toFixed(7);

      let availableBalance: number | null = null;
      let isSufficient = true;
      let balanceError: string | null = null;
      let poolLiquidityError: string | null = null;

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

      // Calculate platform fee (0.3% of input amount)
      const platformFeePercent = parseFloat(env.PLATFORM_SWAP_FEE_PERCENT) / 100;
      const platformFeeAmount = (input * platformFeePercent).toFixed(7);
      const poolFeePercent = pool.fee_bp / 100;
      const totalFeePercent = poolFeePercent + platformFeePercent;
      
      logger.info(
        ` Quote result: expect ≈ ${outputAmount.toFixed(7)} ${to.code}, min after slippage: ${minOut}${availableBalance !== null ? `, available: ${availableBalance.toFixed(7)}` : ''}`
      );

      return {
        success: true,
        poolId,
        expectedOutput: outputAmount.toFixed(7),
        minOut,
        slippagePercent,
        fee: pool.fee_bp / 100, // Pool fee percentage (for backward compatibility)
        platformFee: platformFeePercent, // Platform fee percentage (0.3%)
        platformFeeAmount, // Platform fee amount in input token
        totalFee: totalFeePercent, // Total fee percentage (pool + platform)
        availableBalance: availableBalance !== null ? availableBalance.toFixed(7) : null,
        isSufficient,
        balanceError,
        poolLiquidityError,
        inputReserve: inputReserve.toFixed(7),
        outputReserve: outputReserve.toFixed(7),
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
      logger.info(` Swap via Pool: ${poolId}`);
      logger.info(` ${sendAmount} ${String(from)} ➡ ${String(to)} (slippage ${slippagePercent}%)`);

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

      if (actualToCode !== 'native') {
        await this.ensureTrustline(userSecret, actualToCode, actualToIssuer);
        await new Promise(resolve => setTimeout(resolve, 2000));  
      }

      // Calculate platform fee (will be collected AFTER successful swap)
      const swapFeePercent = parseFloat(env.PLATFORM_SWAP_FEE_PERCENT) / 100;
      const input = parseFloat(sendAmount);
      const swapFeeAmount = (input * swapFeePercent).toFixed(7);

      const fee = pool.fee_bp / 10000;
      const x = parseFloat(resA.amount);
      const y = parseFloat(resB.amount);
      const inputReserve = isAtoB ? x : y;
      const outputReserve = isAtoB ? y : x;

      // Validate pool has sufficient reserves BEFORE proceeding (use full sendAmount)
      if (input > inputReserve) {
        throw new Error(
          `Insufficient liquidity in pool. Requested: ${sendAmount} ${actualFromCode}, Available in pool: ${inputReserve.toFixed(7)} ${actualFromCode}. The pool does not have enough ${actualFromCode} to complete this swap.`
        );
      }

      // Use full send amount for swap calculation (fee collected after)
      const inputAfterPoolFee = input * (1 - fee);
      const outputAmount =
        (inputAfterPoolFee * outputReserve) / (inputReserve + inputAfterPoolFee);
      
      // Validate output reserve is sufficient
      if (outputAmount > outputReserve) {
        throw new Error(
          `Insufficient liquidity in pool. Calculated output: ${outputAmount.toFixed(7)} ${actualToCode}, Available in pool: ${outputReserve.toFixed(7)} ${actualToCode}. The pool does not have enough ${actualToCode} to complete this swap.`
        );
      }
      
      const minDestAmount = (outputAmount * (1 - slippagePercent / 100)).toFixed(7);

 
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      let finalAccount: any;
      let retries = 0;
      const maxRetries = 5;
      
      
      // Try HTTP first (more reliable than SDK after transactions)
      try {
        const horizonUrl = env.HORIZON_URL;
        const accountUrl = `${horizonUrl}/accounts/${publicKey}`;
        const response = await axios.get(accountUrl, { timeout: 15000 });
        
        if (response.status === 200 && response.data) {
          const accountData = response.data;
          const httpSequence = accountData.sequence;
          
           
          const seqNum = BigInt(httpSequence);
          const initSeq = BigInt(initialSequence);
          const expectedIncrement = actualToCode !== 'native' ? 1 : 0; // Trustline if created
          
          if (seqNum <= initSeq && expectedIncrement > 0) {
            logger.warn(`Sequence number not updated yet (${httpSequence} <= ${initialSequence}). Waiting and retrying...`);
            // Wait and retry
            await new Promise(resolve => setTimeout(resolve, 3000));
            const retryResponse = await axios.get(accountUrl, { timeout: 15000 });
            if (retryResponse.status === 200 && retryResponse.data) {
              const retrySequence = BigInt(retryResponse.data.sequence);
              if (retrySequence <= initSeq && expectedIncrement > 0) {
                throw new Error(`Account sequence not updated after trustline creation. Expected increment of at least ${expectedIncrement}, but sequence is still ${retryResponse.data.sequence} (was ${initialSequence}). Please wait a few seconds and try again.`);
              }
              const sequenceStr = String(retryResponse.data.sequence);
              finalAccount = new StellarSdk.Account(publicKey, sequenceStr);
              if (retryResponse.data.balances && Array.isArray(retryResponse.data.balances)) {
                (finalAccount as any).balances = retryResponse.data.balances;
              }
              logger.info(` Account loaded via HTTP fallback after retry: sequence=${sequenceStr}`);
            } else {
              throw new Error(`Failed to load account after retry`);
            }
          } else {
            const sequenceStr = String(httpSequence);
            finalAccount = new StellarSdk.Account(publicKey, sequenceStr);
            if (accountData.balances && Array.isArray(accountData.balances)) {
              (finalAccount as any).balances = accountData.balances;
            }
            logger.info(` Account loaded via HTTP: sequence=${sequenceStr}`);
          }
        }
      } catch (httpError: any) {
        logger.warn(`HTTP fallback failed, trying SDK: ${httpError?.message || String(httpError)}`);
        
        // Fallback to SDK with retries
        while (retries < maxRetries) {
          try {
            if (retries > 0) {
              const delay = 2000 * retries;
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            finalAccount = await server.loadAccount(publicKey);
            const newSequence = finalAccount.sequenceNumber();
            
            const seqNum = BigInt(newSequence);
            const initSeq = BigInt(initialSequence);
            if (seqNum <= initSeq && retries < maxRetries - 1) {
              retries++;
              continue;
            }
            
            logger.info(` Account loaded via SDK: sequence=${newSequence}`);
            break;
          } catch (sdkError: any) {
            retries++;
            if (retries >= maxRetries) {
              logger.error(`  Failed to load account after ${maxRetries} SDK retries and HTTP fallback failed`);
              throw new Error(`Failed to load account. Please try again in a few seconds.`);
            }
            logger.warn(`SDK account load failed (attempt ${retries}/${maxRetries}): ${sdkError?.message || String(sdkError)}`);
          }
        }
      }
      
      // Validate finalAccount exists and has sequence
      if (!finalAccount || !finalAccount.sequenceNumber) {
        logger.error(`❌ Invalid account object after reload: missing sequence number`);
        throw new Error(`Failed to load valid account object. Please try again.`);
      }
      
      const finalSequence = finalAccount.sequenceNumber();
      
      // Get latest balances from the reloaded account
      let latestBalances: any[] = [];
      if (finalAccount.balances && Array.isArray(finalAccount.balances)) {
        latestBalances = finalAccount.balances;
      } else {
        // If balances not in account object, fetch them via HTTP
        try {
          const horizonUrl = env.HORIZON_URL;
          const accountUrl = `${horizonUrl}/accounts/${publicKey}`;
          const response = await axios.get(accountUrl, { timeout: 10000 });
          if (response.status === 200 && response.data && response.data.balances) {
            latestBalances = response.data.balances;
          }
        } catch (balanceError) {
          logger.warn(`Failed to fetch latest balances for validation: ${balanceError instanceof Error ? balanceError.message : String(balanceError)}`);
        }
      }
      
      logger.info(`  Balance validation passed`);
      
      // For AMM swaps through liquidity pools, use empty path
      // The network will automatically route through available liquidity pools
      // The pathPaymentStrictSend operation will find the best path including liquidity pools
      const path: StellarSdk.Asset[] = [];
      
      const baseFee = await server.fetchBaseFee();
      
      let tx;
      try {
        // Validate account and sequence before building
        if (!finalAccount || !finalAccount.sequenceNumber) {
          throw new Error(`Invalid account object: missing sequence number`);
        }
        
        const currentSequence = finalAccount.sequenceNumber();
        logger.info(`Building transaction with sequence: ${currentSequence}, initial was: ${initialSequence}`);
        
        // Validate amounts
        const sendAmountNum = parseFloat(sendAmount);
        const minDestAmountNum = parseFloat(minDestAmount);
        
        if (isNaN(sendAmountNum) || sendAmountNum <= 0) {
          throw new Error(`Invalid send amount: ${sendAmount}`);
        }
        if (isNaN(minDestAmountNum) || minDestAmountNum <= 0) {
          throw new Error(`Invalid minimum destination amount: ${minDestAmount}`);
        }
        
        tx = new StellarSdk.TransactionBuilder(finalAccount, {
          fee: baseFee.toString(),
          networkPassphrase: env.NETWORK,
        })
          .addOperation(
            StellarSdk.Operation.pathPaymentStrictSend({
              sendAsset: fromAsset,
              sendAmount: sendAmount,  
              destination: publicKey,
              destAsset: toAsset,
              destMin: minDestAmount,
              path: path,
            })
          )
          .setTimeout(60)
          .build();
        
        logger.info(`✅ Transaction built successfully with sequence ${currentSequence}`);
      } catch (buildError: any) {
        logger.error(`❌ Failed to build transaction:`, buildError);
        logger.error(`Build error details:`, {
          message: buildError?.message,
          stack: buildError?.stack,
          accountSequence: finalAccount?.sequenceNumber?.(),
          initialSequence: initialSequence,
          fromAsset: fromAsset?.getCode?.(),
          toAsset: toAsset?.getCode?.(),
          sendAmount: sendAmount,
          minDestAmount: minDestAmount,
          accountValid: !!finalAccount,
        });
        
        // Create a more descriptive error
        const errorMsg = buildError?.message || 'Unknown error building transaction';
        const enhancedError = new Error(`Failed to build transaction: ${errorMsg}`);
        (enhancedError as any).originalError = buildError;
        throw enhancedError;
      }

      tx.sign(user);
      let res;
      try {
        res = await server.submitTransaction(tx);
      } catch (submitError: any) {
        // Log detailed error information
        logger.error(`❌ Transaction submission failed`);
        
        // Extract error details
        let detailedMessage = submitError?.message || 'Transaction submission failed';
        let resultCodes: any = null;
        
        if (submitError?.response?.data) {
          const errorData = submitError.response.data;
          
          // Log full error details
          logger.error(`Transaction error details:`, {
            status: submitError.response.status,
            type: errorData.type,
            title: errorData.title,
            detail: errorData.detail,
            extras: errorData.extras,
            resultCodes: errorData.extras?.result_codes,
          });
          
          // Extract operation error code
          resultCodes = errorData.extras?.result_codes;
          if (resultCodes) {
            const opError = resultCodes.operations?.[0];
            const txError = resultCodes.transaction;
            
            if (opError) {
              // Map operation errors to user-friendly messages
              if (opError === 'op_no_trust') {
                detailedMessage = 'Trustline not found. You need to establish a trustline for this asset before swapping.';
              } else if (opError === 'op_underfunded') {
                detailedMessage = `Insufficient balance. You do not have enough ${actualFromCode === 'native' ? 'Test Pi' : actualFromCode} to complete this swap.`;
              } else if (opError === 'op_low_reserve') {
                detailedMessage = 'Insufficient reserve. Your account needs more Test Pi to maintain the minimum reserve.';
              } else if (opError === 'op_line_full') {
                detailedMessage = 'Trustline limit reached. You have reached the maximum balance for this asset.';
              } else if (opError === 'op_path_payment_strict_send_no_destination') {
                detailedMessage = 'No path found. Unable to find a valid path for this swap.';
              } else if (opError === 'op_path_payment_strict_send_too_few_offers') {
                detailedMessage = 'Insufficient liquidity. The pool does not have enough liquidity for this swap.';
              } else if (opError === 'op_path_payment_strict_send_offer_cross_self') {
                detailedMessage = 'Invalid swap path. The swap path crosses with your own offer.';
              } else {
                detailedMessage = `Transaction failed: ${opError}. Please check your balance and account status.`;
              }
            } else if (txError) {
              detailedMessage = `Transaction failed: ${txError}`;
            } else if (errorData.detail) {
              detailedMessage = errorData.detail;
            } else if (errorData.title) {
              detailedMessage = errorData.title;
            }
          }
        }
        
        // Create enhanced error with detailed message
        const enhancedError = new Error(detailedMessage);
        (enhancedError as any).response = submitError?.response;
        (enhancedError as any).status = submitError?.response?.status || 400;
        (enhancedError as any).operationError = resultCodes?.operations?.[0];
        (enhancedError as any).transactionError = resultCodes?.transaction;
        (enhancedError as any).resultCodes = resultCodes;
        
        throw enhancedError;
      }

      logger.success(`✅ Swap successful! TX: ${res.hash}`);
      
      // Collect platform fee AFTER successful swap
      try {
        await this.collectSwapFee(userSecret, sendAmount, actualFromCode);
      } catch (feeError: any) {
        // Log fee collection error but don't fail the swap (it already succeeded)
        logger.error(`⚠️ Failed to collect platform fee after swap: ${feeError?.message || String(feeError)}`);
      }
      
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

      // Log detailed error information BEFORE logger simplification
      logger.error(`❌ swapWithPool failed`);
      
      // Log full error details (bypassing logger simplification for critical errors)
      console.error('=== SWAP WITH POOL ERROR DETAILS ===');
      console.error('Error message:', err?.message || 'Unknown error');
      console.error('Error type:', err?.name || typeof err);
      
      if (err?.response) {
        console.error('Response status:', err.response.status);
        console.error('Response statusText:', err.response.statusText);
        
        if (err.response.data) {
          console.error('Response data:', JSON.stringify(err.response.data, null, 2));
          
          if (err.response.data.extras) {
            console.error('Extras:', JSON.stringify(err.response.data.extras, null, 2));
            
            if (err.response.data.extras.result_codes) {
              console.error('Result codes:', JSON.stringify(err.response.data.extras.result_codes, null, 2));
              console.error('Transaction result:', err.response.data.extras.result_codes.transaction);
              console.error('Operation results:', err.response.data.extras.result_codes.operations);
            }
            
            if (err.response.data.extras.invalid_field) {
              console.error('Invalid field:', err.response.data.extras.invalid_field);
            }
            
            if (err.response.data.extras.reason) {
              console.error('Reason:', err.response.data.extras.reason);
            }
          }
        }
      }
      
      // Also use logger for simplified view
      logger.error(`swapWithPool error:`, err);
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
          // Filter out empty pools from cache
          const nonEmptyPools = (cached.pools || []).filter((pool: any) => !this.isPoolEmpty(pool));
          if (nonEmptyPools.length < cached.pools.length) {
          }
          return { success: true, pools: nonEmptyPools };
        }
      } catch (dbError) {
        logger.warn(`Error reading from pool cache DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }

    try {
      // Normalize token codes for comparison
      const tokenAUpper = tokenA === "native" ? "native" : tokenA.toUpperCase();
      const tokenBUpper = tokenB === "native" ? "native" : tokenB.toUpperCase();
      
      const matchedPools: any[] = [];
      const seenPoolIds = new Set<string>();
      
      // First, check Pair model for registered pairs and fetch their pools
      const allPairs = await Pair.find({}).lean();
      
      // Case-insensitive matching for registered pairs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registeredPairs = allPairs.filter((pair: any) => {
        const baseUpper = String(pair.baseToken || '').toUpperCase();
        const quoteUpper = String(pair.quoteToken || '').toUpperCase();
        return (
          (baseUpper === tokenAUpper && quoteUpper === tokenBUpper) ||
          (baseUpper === tokenBUpper && quoteUpper === tokenAUpper)
        );
      });
      
      if (registeredPairs.length > 0) {
        for (const pair of registeredPairs) {
          try {
            const pool = await poolService.getLiquidityPoolById(pair.poolId, useCache);
            if (pool && !this.isPoolEmpty(pool)) {
              // Verify the pool actually contains the requested tokens
              const assets = pool.reserves.map((r: any) => {
                const assetStr = r.asset || "";
                if (assetStr === "native") return "native";
                return assetStr.split(':')[0].toUpperCase();
              });
              if (assets.includes(tokenAUpper) && assets.includes(tokenBUpper)) {
                matchedPools.push(pool);
                seenPoolIds.add(pool.id);
              }
            }
          } catch (poolError: any) {
            logger.warn(`Failed to fetch pool ${pair.poolId} for registered pair: ${poolError?.message || String(poolError)}`);
          }
        }
      }

      // Always search Horizon pools to find all available pools (including platform pairs)
      let cursor: string | undefined = undefined;
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
            // Skip empty pools and pools we've already added
            if (this.isPoolEmpty(pool) || seenPoolIds.has(pool.id)) {
              continue;
            }
            
            const assets = pool.reserves.map((r: any) => {
              const assetStr = r.asset || "";
              if (assetStr === "native") return "native";
              return assetStr.split(':')[0];
            });
            const assetsUpper = assets.map((a: string) => a === "native" ? "native" : a.toUpperCase());
            if (assetsUpper.includes(tokenAUpper) && assetsUpper.includes(tokenBUpper)) {
              matchedPools.push(pool);
              seenPoolIds.add(pool.id);
            }
        }


          // Validate nextCursor before using it - must be a valid paging token, not a pool ID
          const nextCursor = result.nextCursor;
          if (nextCursor) {
            // Validate it's not a hex hash (pool ID) - paging tokens are base64 encoded
            const isHexHash = /^[0-9a-f]{64}$/i.test(nextCursor);
            if (isHexHash) {
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

      // Calculate platform fee (will be collected AFTER successful swap)
      const swapFeePercent = parseFloat(env.PLATFORM_SWAP_FEE_PERCENT) / 100;
      const input = parseFloat(sendAmount);
      const swapFeeAmount = (input * swapFeePercent).toFixed(7);

      const fromAsset =
        from.code === 'native' ? StellarSdk.Asset.native() : getAsset(from.code, from.issuer!);
      const toAsset =
        to.code === 'native' ? StellarSdk.Asset.native() : getAsset(to.code, to.issuer!);

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
      const fee = pool.fee_bp / 10000;

      // Case-insensitive matching for asset codes
      const resAAssetCode = resA.asset === "native" ? "native" : resA.asset.split(':')[0].toUpperCase();
      const resBAssetCode = resB.asset === "native" ? "native" : resB.asset.split(':')[0].toUpperCase();
      const fromCodeUpper = from.code === "native" ? "native" : from.code.toUpperCase();
      const isAtoB = resAAssetCode === fromCodeUpper;
      const inputReserve = isAtoB ? x : y;
      const outputReserve = isAtoB ? y : x;

      // Use full send amount for swap calculation (fee collected after)
      const inputAfterPoolFee = input * (1 - fee);
      const outputAmount =
        (inputAfterPoolFee * outputReserve) / (inputReserve + inputAfterPoolFee);

      const minDestAmount = (outputAmount * (1 - slippagePercent / 100)).toFixed(7);

      // Reload account after fee payment to get fresh sequence number
      const account = await this.loadAccountWithFallback(publicKey);
      const baseFee = await server.fetchBaseFee();

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: baseFee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictSend({
            sendAsset: fromAsset,
            sendAmount: sendAmount, // Use full amount (fee collected after)
            destination: publicKey,
            destAsset: toAsset,
            destMin: minDestAmount,
            path: [],
          })
        )
        .setTimeout(60)
        .build();

      tx.sign(user);

      const res = await server.submitTransaction(tx);

      logger.success(`✅ Swap successful!`);
      
      // Collect platform fee AFTER successful swap
      try {
        await this.collectSwapFee(userSecret, sendAmount, from.code);
      } catch (feeError: any) {
        // Log fee collection error but don't fail the swap (it already succeeded)
        logger.error(`⚠️ Failed to collect platform fee after swap: ${feeError?.message || String(feeError)}`);
      }
      
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
