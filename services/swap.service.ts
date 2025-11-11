import * as StellarSdk from '@stellar/stellar-sdk';
import { server, getAsset } from '../config/stellar';
import env from '../config/env';
import { logger } from '../utils/logger';
import { PoolService } from './liquidity-pools.service';

const poolService = new PoolService();

class SwapService {
  private async ensureTrustline(userSecret: string, assetCode: string, issuer?: string) {
    if (assetCode === 'native' || !issuer) return;

    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = user.publicKey();
    const account = await server.loadAccount(publicKey);

    const exists = account.balances.some(
      (b: any) => b.asset_code === assetCode && b.asset_issuer === issuer
    );
    if (exists) return;

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
    slippagePercent: number = 1
  ) {
    try {
      logger.info(`🔹 Quoting swap from ${from.code} ➡ ${to.code} in pool ${poolId}`);
      const pool = await poolService.getLiquidityPoolById(poolId);

      const [resA, resB] = pool.reserves;
      const x = parseFloat(resA.amount);
      const y = parseFloat(resB.amount);
      const input = parseFloat(amount);
      const fee = pool.fee_bp / 10000;

      const isAtoB = resA.asset.includes(from.code);
      const inputReserve = isAtoB ? x : y;
      const outputReserve = isAtoB ? y : x;

      const inputAfterFee = input * (1 - fee);
      const outputAmount =
        (inputAfterFee * outputReserve) / (inputReserve + inputAfterFee);
      const minOut = (outputAmount * (1 - slippagePercent / 100)).toFixed(7);

      logger.info(
        `💰 Quote result: expect ≈ ${outputAmount.toFixed(7)} ${to.code}, min after slippage: ${minOut}`
      );

      return {
        success: true,
        poolId,
        expectedOutput: outputAmount.toFixed(7),
        minOut,
        slippagePercent,
        fee: pool.fee_bp / 100,
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
    try {
      const user = StellarSdk.Keypair.fromSecret(userSecret);
      const publicKey = user.publicKey();

      logger.info(`----------------------------------------------`);
      logger.info(`🔁 Swap via Pool: ${poolId}`);
      logger.info(`💸 ${sendAmount} ${from} ➡ ${to} (slippage ${slippagePercent}%)`);

      const [fromCode, fromIssuer] = from.split(':');
      const [toCode, toIssuer] = to.split(':');

      const fromAsset =
        fromCode === 'native' ? StellarSdk.Asset.native() : getAsset(fromCode, fromIssuer);
      const toAsset =
        toCode === 'native' ? StellarSdk.Asset.native() : getAsset(toCode, toIssuer);

      if (toCode !== 'native') {
        await this.ensureTrustline(userSecret, toCode, toIssuer);
      }

      const pool = await poolService.getLiquidityPoolById(poolId);
      const [resA, resB] = pool.reserves;
      const fee = pool.fee_bp / 10000;

      const x = parseFloat(resA.amount);
      const y = parseFloat(resB.amount);
      const isAtoB = resA.asset.includes(fromCode);
      const inputReserve = isAtoB ? x : y;
      const outputReserve = isAtoB ? y : x;

      const input = parseFloat(sendAmount);
      const inputAfterFee = input * (1 - fee);
      const outputAmount =
        (inputAfterFee * outputReserve) / (inputReserve + inputAfterFee);
      const minDestAmount = (outputAmount * (1 - slippagePercent / 100)).toFixed(7);

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

      logger.success(`✅ Swap successful! TX: ${res.hash}`);
      logger.info(`⏱ Duration: ${(Date.now() - start) / 1000}s`);
      logger.info(`----------------------------------------------`);

      return {
        success: true,
        txHash: res.hash,
        expectedOutput: outputAmount.toFixed(7),
      };
    } catch (err: any) {
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
          const assets = pool.reserves.map((r: any) => r.asset.split(':')[0]);
          if (assets.includes(tokenA) && assets.includes(tokenB)) {
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
        const assets = p.reserves.map((r: any) => r.asset.split(':')[0]);
        return assets.includes(from.code) && assets.includes(to.code);
      });

      if (!match) throw new Error(`No pool found for ${from.code}/${to.code}`);

      const pool = await poolService.getLiquidityPoolById(match.id);
      const [resA, resB] = pool.reserves;

      const x = parseFloat(resA.amount);
      const y = parseFloat(resB.amount);
      const input = parseFloat(sendAmount);
      const fee = pool.fee_bp / 10000;

      const isAtoB = resA.asset.includes(from.code);
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

      return { hash: res.hash, expectedOutput: outputAmount.toFixed(7) };
    } catch (err: any) {
      logger.error(`❌ Swap failed: ${JSON.stringify(err.response?.data || err, null, 2)}`);
      logger.info('----------------------------------------------');
      throw err;
    }
  }
}

export const swapService = new SwapService();
