
import * as StellarSdk from "@stellar/stellar-sdk";
import { server } from "../config/stellar";
import env from "../config/env";

export class TradeService {
  async createSellOffer(
    userSecret: string,
    selling: StellarSdk.Asset,
    buying: StellarSdk.Asset,
    amount: string, 
    price: string 
  ) {
    const kp = StellarSdk.Keypair.fromSecret(userSecret);
    const account = await server.loadAccount(kp.publicKey());
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
  }

  async createBuyOffer(
    userSecret: string,
    buying: StellarSdk.Asset,
    selling: StellarSdk.Asset,
    buyAmount: string, // desired buy amount (in buying asset)
    price: string
  ) {
    const kp = StellarSdk.Keypair.fromSecret(userSecret);
    const account = await server.loadAccount(kp.publicKey());
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
  }

  async cancelSellOffer(
    userSecret: string,
    selling: StellarSdk.Asset,
    buying: StellarSdk.Asset,
    offerId: string
  ) {
    const kp = StellarSdk.Keypair.fromSecret(userSecret);
    const account = await server.loadAccount(kp.publicKey());
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
  }
}

export const tradeService = new TradeService();
