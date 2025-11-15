
import * as StellarSdk from "@stellar/stellar-sdk";
import { server } from "../config/stellar";
import env from "../config/env";
import { logger } from "../utils/logger";

export class TradeService {
  async createSellOffer(
    userSecret: string,
    selling: StellarSdk.Asset,
    buying: StellarSdk.Asset,
    amount: string, 
    price: string 
  ) {
    const kp = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = kp.publicKey();
    
    try {
      const account = await server.loadAccount(publicKey);
      const fee = await server.fetchBaseFee();
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: fee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.manageSellOffer({
            selling,
            buying,
            amount,
            price,
            offerId: "0", 
          })
        )
        .setTimeout(60)
        .build();
      tx.sign(kp);
      const result = await server.submitTransaction(tx);
      return result;
    } catch (error: any) {
      // Handle account not found error
      if (error?.response?.status === 404 || error?.constructor?.name === 'NotFoundError') {
        logger.error(`Account ${publicKey} not found on Pi network`);
        throw new Error(`Account not found on Pi network. Please ensure your account has been created and funded.`);
      }

      // Handle transaction failure (400 Bad Request)
      if (error?.response?.status === 400 && error?.response?.data) {
        const errorData = error.response.data;
        const resultCodes = errorData.extras?.result_codes;
        const operationsResultCodes = resultCodes?.operations || [];
        const transactionResultCode = resultCodes?.transaction || 'unknown';

        // Build detailed error message
        let errorMessage = 'Transaction failed';
        
        if (transactionResultCode === 'tx_failed') {
          if (operationsResultCodes.length > 0) {
            const opError = operationsResultCodes[0];
            if (opError === 'op_no_trust') {
              errorMessage = 'Trustline not found. You need to establish a trustline for this asset before trading.';
            } else if (opError === 'op_underfunded') {
              errorMessage = 'Insufficient balance. You do not have enough of this asset to complete the trade.';
            } else if (opError === 'op_low_reserve') {
              errorMessage = 'Insufficient reserve. Your account needs more Test Pi to maintain the minimum reserve.';
            } else if (opError === 'op_line_full') {
              errorMessage = 'Trustline limit reached. You have reached the maximum balance for this asset.';
            } else {
              errorMessage = `Transaction failed: ${opError}. Please check your balance and trustlines.`;
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

        throw new Error(errorMessage);
      }

      // Re-throw other errors
      logger.error(`Unexpected error creating sell offer for account ${publicKey}:`, error);
      throw error;
    }
  }

  async createBuyOffer(
    userSecret: string,
    buying: StellarSdk.Asset,
    selling: StellarSdk.Asset,
    buyAmount: string, // desired buy amount (in buying asset)
    price: string
  ) {
    const kp = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = kp.publicKey();
    
    try {
      const account = await server.loadAccount(publicKey);
      const fee = await server.fetchBaseFee();
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: fee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.manageBuyOffer({
            buying,
            selling,
            buyAmount,
            price,
            offerId: "0",
          })
        )
        .setTimeout(60)
        .build();
      tx.sign(kp);
      const result = await server.submitTransaction(tx);
      return result;
    } catch (error: any) {
      // Handle account not found error
      if (error?.response?.status === 404 || error?.constructor?.name === 'NotFoundError') {
        logger.error(`Account ${publicKey} not found on Pi network`);
        throw new Error(`Account not found on Pi network. Please ensure your account has been created and funded.`);
      }

      // Handle transaction failure (400 Bad Request)
      if (error?.response?.status === 400 && error?.response?.data) {
        const errorData = error.response.data;
        const resultCodes = errorData.extras?.result_codes;
        const operationsResultCodes = resultCodes?.operations || [];
        const transactionResultCode = resultCodes?.transaction || 'unknown';

        // Build detailed error message
        let errorMessage = 'Transaction failed';
        
        if (transactionResultCode === 'tx_failed') {
          if (operationsResultCodes.length > 0) {
            const opError = operationsResultCodes[0];
            if (opError === 'op_no_trust') {
              errorMessage = 'Trustline not found. You need to establish a trustline for this asset before trading.';
            } else if (opError === 'op_underfunded') {
              errorMessage = 'Insufficient balance. You do not have enough of this asset to complete the trade.';
            } else if (opError === 'op_low_reserve') {
              errorMessage = 'Insufficient reserve. Your account needs more Test Pi to maintain the minimum reserve.';
            } else if (opError === 'op_line_full') {
              errorMessage = 'Trustline limit reached. You have reached the maximum balance for this asset.';
            } else {
              errorMessage = `Transaction failed: ${opError}. Please check your balance and trustlines.`;
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

        throw new Error(errorMessage);
      }

      // Re-throw other errors
      logger.error(`Unexpected error creating buy offer for account ${publicKey}:`, error);
      throw error;
    }
  }

  async cancelSellOffer(
    userSecret: string,
    selling: StellarSdk.Asset,
    buying: StellarSdk.Asset,
    offerId: string
  ) {
    const kp = StellarSdk.Keypair.fromSecret(userSecret);
    const publicKey = kp.publicKey();
    
    try {
      const account = await server.loadAccount(publicKey);
      const fee = await server.fetchBaseFee();
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: fee.toString(),
        networkPassphrase: env.NETWORK,
      })
        .addOperation(
          StellarSdk.Operation.manageSellOffer({
            selling,
            buying,
            amount: "0", 
            price: "1",
            offerId,
          })
        )
        .setTimeout(60)
        .build();
      tx.sign(kp);
      const result = await server.submitTransaction(tx);
      return result;
    } catch (error: any) {
      // Handle account not found error
      if (error?.response?.status === 404 || error?.constructor?.name === 'NotFoundError') {
        logger.error(`Account ${publicKey} not found on Pi network`);
        throw new Error(`Account not found on Pi network. Please ensure your account has been created and funded.`);
      }

      // Handle transaction failure (400 Bad Request)
      if (error?.response?.status === 400 && error?.response?.data) {
        const errorData = error.response.data;
        const resultCodes = errorData.extras?.result_codes;
        const operationsResultCodes = resultCodes?.operations || [];
        const transactionResultCode = resultCodes?.transaction || 'unknown';

        // Build detailed error message
        let errorMessage = 'Transaction failed';
        
        if (transactionResultCode === 'tx_failed') {
          if (operationsResultCodes.length > 0) {
            const opError = operationsResultCodes[0];
            if (opError === 'op_no_trust') {
              errorMessage = 'Trustline not found. You need to establish a trustline for this asset before trading.';
            } else if (opError === 'op_underfunded') {
              errorMessage = 'Insufficient balance. You do not have enough of this asset to complete the trade.';
            } else if (opError === 'op_low_reserve') {
              errorMessage = 'Insufficient reserve. Your account needs more Test Pi to maintain the minimum reserve.';
            } else if (opError === 'op_line_full') {
              errorMessage = 'Trustline limit reached. You have reached the maximum balance for this asset.';
            } else {
              errorMessage = `Transaction failed: ${opError}. Please check your balance and trustlines.`;
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

        throw new Error(errorMessage);
      }

      // Re-throw other errors
      logger.error(`Unexpected error canceling offer for account ${publicKey}:`, error);
      throw error;
    }
  }
}

export const tradeService = new TradeService();
