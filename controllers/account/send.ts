import { Request, Response } from 'express';
import { accountService } from '../../services/account.service';
import { logger } from '../../utils/logger';
import * as StellarSdk from '@stellar/stellar-sdk';
import { server } from '../../config/stellar';
import env from '../../config/env';
import axios from 'axios';

export const sendPayment = async (req: Request, res: Response) => {
  try {
    const { userSecret, destination, asset, amount, memo } = req.body;

    if (!userSecret) {
      return res.status(400).json({ success: false, message: 'User secret is required' });
    }
    if (!destination) {
      return res.status(400).json({ success: false, message: 'Destination address is required' });
    }
    if (!asset || !asset.code) {
      return res.status(400).json({ success: false, message: 'Asset code is required' });
    }
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }

    const user = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = user.publicKey();

    // Load sender account
    let senderAccount: any;
    try {
      senderAccount = await server.loadAccount(publicKey);
    } catch (error: any) {
      logger.error(`Failed to load sender account: ${error.message}`);
      return res.status(400).json({ success: false, message: 'Failed to load sender account' });
    }

    // Check sender balance
    const isNative = asset.code === 'native' || asset.code.toLowerCase() === 'pi';
    let senderBalance = 0;
    
    if (isNative) {
      const nativeBalance = senderAccount.balances.find((b: any) => b.asset_type === 'native');
      senderBalance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
    } else {
      const tokenBalance = senderAccount.balances.find(
        (b: any) => b.asset_code === asset.code && b.asset_issuer === asset.issuer
      );
      senderBalance = tokenBalance ? parseFloat(tokenBalance.balance) : 0;
    }

    if (senderBalance < parseFloat(amount)) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. You have ${senderBalance} ${asset.code}`,
      });
    }
    if (!isNative && asset.issuer) {
      try {
        // Try to load receiver account directly from blockchain
        const receiverAccount = await server.loadAccount(destination);
        const hasTrustline = receiverAccount.balances.some(
          (b: any) => 
            b.asset_type !== 'native' && 
            b.asset_type !== 'liquidity_pool_shares' &&
            b.asset_code === asset.code && 
            b.asset_issuer === asset.issuer
        );

        if (!hasTrustline) {
          return res.status(400).json({
            success: false,
            message: 'Receiver does not have a trustline for this token',
            receiverNeedsTrustline: true,
          });
        }
      } catch (error: any) {
        
        const isNotFound = error?.response?.status === 404 || 
                          error?.constructor?.name === 'NotFoundError' ||
                          (error?.response?.data?.type === 'https://stellar.org/horizon-errors/not_found');
        
        if (isNotFound) {
          return res.status(400).json({
            success: false,
            message: 'Receiver account does not exist or does not have a trustline for this token',
            receiverNeedsTrustline: true,
          });
        }
        
        // For other errors, log and proceed (Stellar will handle it)
        logger.warn(`Could not check receiver trustline: ${error.message}`);
      }
    }

    // Build payment asset
    const paymentAsset = isNative
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(asset.code, asset.issuer);

    // Get base fee
    const baseFee = await server.fetchBaseFee();

    // Reload account to get fresh sequence
    const freshAccount = await server.loadAccount(publicKey);

    // Build transaction
    const txBuilder = new StellarSdk.TransactionBuilder(freshAccount, {
      fee: baseFee.toString(),
      networkPassphrase: env.NETWORK,
    });

    // Add payment operation
    const paymentOp = StellarSdk.Operation.payment({
      destination,
      asset: paymentAsset,
      amount: amount.toString(),
    });

    txBuilder.addOperation(paymentOp);

    // Add memo if provided
    if (memo) {
      txBuilder.addMemo(StellarSdk.Memo.text(memo));
    }

    const tx = txBuilder.setTimeout(60).build();
    tx.sign(user);

    // Submit transaction
    try {
      const txXdr = tx.toXDR();
      const submitUrl = `${env.HORIZON_URL}/transactions`;

      const response = await axios.post(submitUrl, `tx=${encodeURIComponent(txXdr)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      });

      logger.success(`✅ Payment sent - Hash: ${response.data.hash}`);

      // Clear balance cache for both sender and receiver
      accountService.clearBalanceCache(publicKey).catch((err) => {
        logger.warn(`Failed to clear sender balance cache: ${err}`);
      });
      accountService.clearBalanceCache(destination).catch((err) => {
        logger.warn(`Failed to clear receiver balance cache: ${err}`);
      });

      return res.json({
        success: true,
        transactionHash: response.data.hash,
        ledger: response.data.ledger,
      });
    } catch (submitError: any) {
      const errorMessage =
        submitError.response?.data?.extras?.result_codes?.transaction ||
        submitError.response?.data?.extras?.result_codes?.operations?.[0] ||
        submitError.message ||
        'Transaction failed';

      logger.error(`Payment transaction failed: ${errorMessage}`);
      return res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }
  } catch (err: any) {
    logger.error('❌ sendPayment error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to send payment',
    });
  }
};

