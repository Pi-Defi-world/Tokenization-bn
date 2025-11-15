
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
      return server.submitTransaction(tx);
    } catch (error: any) {
      // Handle account not found error
      if (error?.response?.status === 404 || error?.constructor?.name === 'NotFoundError') {
        logger.error(`Account ${publicKey} not found on Pi network`);
        throw new Error(`Account not found on Pi network. Please ensure your account has been created and funded.`);
      }
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
      return server.submitTransaction(tx);
    } catch (error: any) {
      // Handle account not found error
      if (error?.response?.status === 404 || error?.constructor?.name === 'NotFoundError') {
        logger.error(`Account ${publicKey} not found on Pi network`);
        throw new Error(`Account not found on Pi network. Please ensure your account has been created and funded.`);
      }
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
      return server.submitTransaction(tx);
    } catch (error: any) {
      // Handle account not found error
      if (error?.response?.status === 404 || error?.constructor?.name === 'NotFoundError') {
        logger.error(`Account ${publicKey} not found on Pi network`);
        throw new Error(`Account not found on Pi network. Please ensure your account has been created and funded.`);
      }
      throw error;
    }
  }
}

export const tradeService = new TradeService();
