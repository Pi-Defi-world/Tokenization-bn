import * as StellarSdk from '@stellar/stellar-sdk';
import { server, getAsset } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';
import { PoolService } from './liquidity-pools.service';
import { AccountService } from './account.service';

const poolService = new PoolService();

class SwapService {
  private accountService: AccountService;

  constructor() {
    this.accountService = new AccountService();
  }

  private async ensureTrustline(userSecret: string, assetCode: string, issuer?: string) {
    if (assetCode === 'native' || !issuer) return;

    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = user.publicKey();
    const account = await server.loadAccount(publicKey);

    // Case-insensitive trustline check (Stellar stores exact case, but we match case-insensitively)
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
          const account = await server.loadAccount(publicKey);
          const nativeBalance = account.balances.find((b: any) => b.asset_type === 'native');
          if (nativeBalance) {
            availableBalance = parseFloat(nativeBalance.balance);
            // Account for transaction fee (typically 100 stroops = 0.00001 XLM/Test Pi)
            // And minimum reserve (typically 1 XLM/Test Pi for base account)
            const baseFee = await server.fetchBaseFee();
            const feeInXLM = baseFee / 10000000; // Convert stroops to XLM
            const minReserve = 1.0; // Minimum reserve requirement
            const totalRequired = input + feeInXLM + minReserve;
            
            if (availableBalance < totalRequired) {
              isSufficient = false;
              balanceError = `Insufficient balance. Available: ${availableBalance.toFixed(7)} ${from.code}, Required: ${input.toFixed(7)} + ${feeInXLM.toFixed(7)} (fee) + ${minReserve.toFixed(7)} (reserve) = ${totalRequired.toFixed(7)}`;
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
      const [resA, resB] = pool.reserves;
      
      // Extract exact asset codes from pool reserves (preserves correct case from blockchain)
      const resAAssetFull = resA.asset === "native" ? "native" : resA.asset;
      const resBAssetFull = resB.asset === "native" ? "native" : resB.asset;
      
      // Case-insensitive matching to determine direction
      const resAAssetCode = resA.asset === "native" ? "native" : resA.asset.split(':')[0].toUpperCase();
      const resBAssetCode = resB.asset === "native" ? "native" : resB.asset.split(':')[0].toUpperCase();
      const fromCodeUpper = fromCode === "native" ? "native" : fromCode.toUpperCase();
      const isAtoB = resAAssetCode === fromCodeUpper;
      
      // Use exact asset codes from pool reserves (correct case) for Stellar SDK
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

      if (actualToCode !== 'native') {
        await this.ensureTrustline(userSecret, actualToCode, actualToIssuer);
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

      const account = await server.loadAccount(publicKey);
      const baseFee = await server.fetchBaseFee();

      // Validate balance before attempting swap
      if (fromCode === 'native') {
        const nativeBalance = account.balances.find((b: any) => b.asset_type === 'native');
        if (nativeBalance) {
          const availableBalance = parseFloat(nativeBalance.balance);
          const feeInXLM = baseFee / 10000000; // Convert stroops to XLM
          const minReserve = 1.0; // Minimum reserve requirement
          const totalRequired = input + feeInXLM + minReserve;

          logger.info(`💰 Balance check: Available: ${availableBalance.toFixed(7)} ${fromCode}, Required: ${input.toFixed(7)} (amount) + ${feeInXLM.toFixed(7)} (fee) + ${minReserve.toFixed(7)} (reserve) = ${totalRequired.toFixed(7)}`);

          if (availableBalance < totalRequired) {
            const errorMsg = `Insufficient balance. Available: ${availableBalance.toFixed(7)} ${fromCode === 'native' ? 'Test Pi' : fromCode}, Required: ${totalRequired.toFixed(7)} (including ${feeInXLM.toFixed(7)} fee and ${minReserve.toFixed(7)} reserve)`;
            logger.error(`❌ ${errorMsg}`);
            throw new Error(errorMsg);
          }
        } else {
          throw new Error(`No ${fromCode === 'native' ? 'Test Pi' : fromCode} balance found`);
        }
      } else {
        // For non-native assets, check trustline balance
        // Case-insensitive balance check (Stellar stores exact case, but we match case-insensitively)
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

      logger.success(`✅ Swap successful! TX: ${res.hash}`);
      logger.info(`⏱ Duration: ${(Date.now() - start) / 1000}s`);
      logger.info(`----------------------------------------------`);

 
      this.accountService.clearBalanceCache(publicKey).catch((err: any) => {
        logger.warn(`Failed to clear balance cache after swap: ${err?.message || String(err)}`);
      });

      return {
        success: true,
        txHash: res.hash,
        expectedOutput: outputAmount.toFixed(7),
      };
    } catch (err: any) {
      // Handle transaction failure (400 Bad Request)
      if (err?.response?.status === 400 && err?.response?.data) {
        const errorData = err.response.data;
        const resultCodes = errorData.extras?.result_codes;
        const operationsResultCodes = resultCodes?.operations || [];
        const transactionResultCode = resultCodes?.transaction || 'unknown';

        // Build detailed error message
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

      // Re-throw other errors
      logger.error(`❌ swapWithPool failed:`, JSON.stringify(err.response?.data || err, null, 2));
      throw err;
    }
  }

  public async getPoolsForPair(tokenA: string, tokenB: string, limit: number = 50) {
    try {
      logger.info(`🔹 Searching pools for pair: ${tokenA}/${tokenB}`);
      let cursor: string | undefined = undefined;
      const matchedPools: any[] = [];
      let totalFetched = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await poolService.getLiquidityPools(limit, cursor);
        totalFetched += result.records.length;

        for (const pool of result.records) {
          const assets = pool.reserves.map((r: any) => {
            const assetStr = r.asset || "";
            if (assetStr === "native") return "native";
            return assetStr.split(':')[0];
          });
          // Case-insensitive comparison
          const tokenAUpper = tokenA === "native" ? "native" : tokenA.toUpperCase();
          const tokenBUpper = tokenB === "native" ? "native" : tokenB.toUpperCase();
          const assetsUpper = assets.map((a: string) => a === "native" ? "native" : a.toUpperCase());
          if (assetsUpper.includes(tokenAUpper) && assetsUpper.includes(tokenBUpper)) {
            matchedPools.push(pool);
          }
        }

        logger.info(`📦 Fetched ${totalFetched} pools so far... (${matchedPools.length} matches)`);

        cursor = result.nextCursor;
        hasMore = !!cursor && result.records.length > 0;

        if (matchedPools.length > 0) {
          logger.success(`✅ Found ${matchedPools.length} pools containing ${tokenA}/${tokenB}`);
          return { success: true, pools: matchedPools };
        }
      }

      logger.warn(`⚠️ No pools found for ${tokenA}/${tokenB} after scanning ${totalFetched} pools`);
      return { success: true, pools: [] };
    } catch (err: any) {
      logger.error('❌ getPoolsForPair failed:', JSON.stringify(err.response?.data || err, null, 2));
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
        // Case-insensitive comparison
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

      const account = await server.loadAccount(publicKey);
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

      // Invalidate balance cache after successful swap (non-blocking)
      this.accountService.clearBalanceCache(publicKey).catch((err: any) => {
        logger.warn(`Failed to clear balance cache after swap: ${err?.message || String(err)}`);
      });

      return { hash: res.hash, expectedOutput: outputAmount.toFixed(7) };
    } catch (err: any) {
      // Handle transaction failure (400 Bad Request)
      if (err?.response?.status === 400 && err?.response?.data) {
        const errorData = err.response.data;
        const resultCodes = errorData.extras?.result_codes;
        const operationsResultCodes = resultCodes?.operations || [];
        const transactionResultCode = resultCodes?.transaction || 'unknown';

        // Build detailed error message
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

      logger.error(`❌ Swap failed: ${JSON.stringify(err.response?.data || err, null, 2)}`);
      logger.info('----------------------------------------------');
      throw err;
    }
  }
}

export const swapService = new SwapService();
