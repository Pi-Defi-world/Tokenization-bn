// wallet.service.ts
// Service for generating wallets and seeding them with test Pi
// Adapted from WalletService.js to work with Mongoose instead of Prisma

import * as StellarSdk from '@stellar/stellar-sdk';
import User from '../models/User';
import { logger } from '../utils/logger';
import env from '../config/env';
import { server } from '../config/stellar';

export interface CreateWalletResult {
  publicKey: string;
  secretKey: string;
  seedResult: {
    success: boolean;
    transactionHash: string;
    accountCreated: boolean;
    amount: string;
  };
}

export class WalletService {
  private serverUrl: string;
  private networkPassphrase: string;
  private server: StellarSdk.Horizon.Server;
  private seedAmount: string;
  private faucetSecretKey: string | undefined;
  private faucetPublicKey: string | undefined;

  constructor() {
    this.serverUrl = process.env.PI_NETWORK_SERVER_URL || env.HORIZON_URL || 'https://api.testnet.minepi.com';
    this.networkPassphrase = process.env.PI_TESTNET_PASSPHRASE || env.NETWORK || 'Pi Testnet';
    this.server = server;
    this.seedAmount = process.env.PI_SEED_AMOUNT || '2'; // Default 2 Test-Pi
    this.faucetSecretKey = process.env.PI_TEST_USER_SECRET_KEY;
    this.faucetPublicKey = process.env.PI_TEST_USER_PUBLIC_KEY;
    
    if (!this.faucetSecretKey) {
      logger.warn('PI_TEST_USER_SECRET_KEY not found in environment variables. Wallet seeding will fail.');
    }
    if (!this.faucetPublicKey) {
      logger.warn('PI_TEST_USER_PUBLIC_KEY not found in environment variables.');
    }
  }

  /**
   * Generates a new Stellar/Pi keypair
   * @returns {Object} Object with publicKey and secretKey
   */
  generateNewWallet() {
    const keypair = StellarSdk.Keypair.random();
    return {
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret(),
    };
  }

  /**
   * Seeds a new wallet with test Pi from the faucet account
   * @param {string} destPublicKey - Destination wallet public key
   * @returns {Promise<Object>} Transaction result
   */
  async seedNewWallet(destPublicKey: string) {
    if (!this.faucetSecretKey) {
      throw new Error('PI_TEST_USER_SECRET_KEY not configured. Cannot seed wallet.');
    }

    const networkPassphrase = this.networkPassphrase;

    // Create faucet keypair
    const faucetKeypair = StellarSdk.Keypair.fromSecret(this.faucetSecretKey);
    const faucetPublicKey = faucetKeypair.publicKey();

    logger.info(`Checking if account exists: ${destPublicKey}`);

    // Check if the account already exists on-chain
    let accountExists = false;
    try {
      await this.server.loadAccount(destPublicKey);
      accountExists = true;
      logger.info(`Account ${destPublicKey} already exists`);
    } catch (error: any) {
      if (error.status === 404 || error.response?.status === 404) {
        accountExists = false;
        logger.info(`Account ${destPublicKey} does not exist yet (will create it)`);
      } else {
        throw error;
      }
    }

    // Load faucet account
    logger.info(`Loading faucet account: ${faucetPublicKey}`);
    const sourceAccount = await this.server.loadAccount(faucetPublicKey);

    // Check faucet balance
    const faucetBalance = sourceAccount.balances.find((b: any) => b.asset_type === 'native');
    const faucetPiBalance = faucetBalance ? parseFloat(faucetBalance.balance) : 0;
    logger.info(`Faucet Balance: ${faucetPiBalance.toFixed(7)} Test-Pi`);

    if (faucetPiBalance < parseFloat(this.seedAmount) + 0.00001) {
      throw new Error(
        `Insufficient faucet balance. Need at least ${parseFloat(this.seedAmount) + 0.00001} Test-Pi, ` +
        `but faucet only has ${faucetPiBalance.toFixed(7)} Test-Pi`
      );
    }

    // Build transaction
    const baseFee = await this.server.fetchBaseFee();
    const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: baseFee.toString(),
      networkPassphrase: networkPassphrase,
    });

    if (!accountExists) {
      // Create the account with starting balance
      logger.info(`Creating new account with ${this.seedAmount} Test-Pi starting balance...`);
      txBuilder.addOperation(
        StellarSdk.Operation.createAccount({
          destination: destPublicKey,
          startingBalance: this.seedAmount,
        })
      );
    } else {
      // If it already exists, just send Test-Pi as a normal payment
      logger.info(`Sending ${this.seedAmount} Test-Pi to existing account...`);
      txBuilder.addOperation(
        StellarSdk.Operation.payment({
          destination: destPublicKey,
          asset: StellarSdk.Asset.native(),
          amount: this.seedAmount,
        })
      );
    }

    // Build and sign transaction
    const transaction = txBuilder.setTimeout(60).build();
    transaction.sign(faucetKeypair);

    // Submit transaction
    logger.info('Submitting transaction...');
    const response = await this.server.submitTransaction(transaction);

    return {
      success: true,
      transactionHash: response.hash,
      accountCreated: !accountExists,
      amount: this.seedAmount,
    };
  }

  /**
   * Generate a new wallet and link it to a user (using Mongoose)
   * Clears old public_key for the user before creating the new one
   * @param {string} userId - User ID to link wallet to
   * @returns {Promise<CreateWalletResult>} Wallet details with public key and secret key
   */
  async generateAndLinkWallet(userId: string): Promise<CreateWalletResult> {
    // Clear old public_key for this user before creating new one
    logger.info(`Clearing old wallet for user ${userId}...`);
    
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Clear old public_key (set to null to work with sparse unique index)
      user.public_key = undefined;
      await user.save();
      logger.info(`Cleared public_key from User table for user ${userId}`);
    } catch (error: any) {
      logger.warn(`Could not clear User.public_key (may already be null or user not found): ${error?.message || String(error)}`);
      // Continue anyway
    }

    // Generate new wallet
    logger.info(`Generating new wallet for user ${userId}...`);
    const newWallet = this.generateNewWallet();
    logger.info(`Generated wallet: ${newWallet.publicKey}`);

    // Seed the wallet with test Pi
    logger.info(`Seeding wallet with test Pi...`);
    const seedResult = await this.seedNewWallet(newWallet.publicKey);

    if (!seedResult.success) {
      throw new Error('Failed to seed wallet with test Pi');
    }

    // Update User.public_key
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.public_key = newWallet.publicKey;
    await user.save();

    logger.info(`Wallet ${newWallet.publicKey} linked to user ${userId}`);

    return {
      publicKey: newWallet.publicKey,
      secretKey: newWallet.secretKey,
      seedResult: seedResult,
    };
  }

  /**
   * Create a new wallet (clears old wallets if user forgot secret seed)
   * This is the same as generateAndLinkWallet but with clearer naming
   * @param {string} userId - User ID
   * @returns {Promise<CreateWalletResult>} New wallet details
   */
  async createNewWallet(userId: string): Promise<CreateWalletResult> {
    // Clear old wallets and create new one
    return this.generateAndLinkWallet(userId);
  }

  /**
   * Get user's primary wallet address
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} Primary wallet address or null
   */
  async getPrimaryWalletAddress(userId: string): Promise<string | null> {
    const user = await User.findById(userId);
    return user?.public_key || null;
  }

  /**
   * Validate that a secret seed matches a wallet address
   * @param {string} secretSeed - Secret seed key
   * @param {string} walletAddress - Expected wallet address
   * @returns {boolean} True if secret seed matches wallet address
   */
  validateSecretSeed(secretSeed: string, walletAddress: string): boolean {
    try {
      const keypair = StellarSdk.Keypair.fromSecret(secretSeed);
      return keypair.publicKey() === walletAddress;
    } catch (error) {
      logger.error('Error validating secret seed:', error);
      return false;
    }
  }
}

export default WalletService;

