import { server } from '../config/stellar';
import { getKeypairFromMnemonic, getKeypairFromSecret } from '../utils/keypair';
import User from '../models/User';
import { logger } from '../utils/logger';

export interface ImportAccountInput {
  mnemonic?: string;
  secret?: string;
  userId?: string;
}

export interface TransactionsQuery {
  publicKey: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}

export interface OperationsQuery {
  publicKey: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}

export class AccountService {
  public async importAccount(input: ImportAccountInput) {
    const { mnemonic, secret, userId } = input;
    if (!mnemonic && !secret) {
      throw new Error('Provide mnemonic or secret');
    }

    let publicKey: string;
    let secretKey: string;

    if (mnemonic) {
      const kp = await getKeypairFromMnemonic(mnemonic);
      publicKey = kp.publicKey();
      secretKey = kp.secret();
    } else {
      const kp = getKeypairFromSecret(secret as string);
      publicKey = kp.publicKey();
      secretKey = kp.secret();
    }

    // If userId is provided, validate public key matches existing user's public_key
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        if (user.public_key && user.public_key.trim() !== '') {
          if (user.public_key !== publicKey) {
            throw new Error('Invalid credentials. Please check your mnemonic/secret.');
          }
          logger.info(`Public key validated for user ${userId}`);
        } else {
          // User exists but doesn't have public_key, store it
          user.public_key = publicKey;
          await user.save();
          logger.info(`Public key stored for user ${userId}`);
        }
      } else {
        throw new Error('User not found');
      }
    }

    return { publicKey, secret: secretKey };
  }

  public async getBalances(publicKey: string) {
    if (!publicKey) {
      throw new Error('publicKey is required');
    }

    try {
      const account = await server.loadAccount(publicKey);

      const THRESHOLD = 0.1;

      const balances = (account.balances || [])
        .map((b: any) => {
          const amountNum =
            typeof b.balance === 'string' ? parseFloat(b.balance) : Number(b.balance || 0);

          let assetLabel: string;
          if (b.asset_type === 'native') {
            assetLabel = 'Test Pi';
          } else if (b.asset_type === 'liquidity_pool_shares') {
            assetLabel = `liquidity_pool:${b.liquidity_pool_id || 'unknown'}`;
          } else {
            assetLabel = `${b.asset_code}:${b.asset_issuer}`;
          }

          return {
            assetType: b.asset_type,
            assetCode: b.asset_code || 'XLM',
            assetIssuer: b.asset_issuer || null,
            asset: assetLabel,
            amount: amountNum,
            raw: b.balance,
          };
        })
        .filter((entry: any) => {
          if (Number.isNaN(entry.amount)) return false;
          return entry.amount > THRESHOLD;
        });

      return { publicKey, balances };
    } catch (error: any) {
      // Log the actual error for debugging
      logger.error(`Error fetching balances for account ${publicKey}:`, {
        message: error?.message,
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        errorType: error?.constructor?.name,
        responseData: error?.response?.data,
      });

      // Only treat as "account not found" if:
      // 1. HTTP status is 404 (Not Found)
      // 2. OR error message specifically mentions account not found
      // 3. OR it's a Stellar NotFoundError
      const isNotFoundError =
        error?.response?.status === 404 ||
        error?.constructor?.name === 'NotFoundError' ||
        (error?.message && (
          error.message.toLowerCase().includes('account not found') ||
          error.message.toLowerCase().includes('not found: account') ||
          error.message === 'Not Found'
        ));

      if (isNotFoundError) {
        logger.info(`Account ${publicKey} not found on Pi network, returning empty balances`);
        return { publicKey, balances: [] };
      }

      // Re-throw other errors (network issues, server errors, etc.)
      logger.error(`Failed to fetch balances for account ${publicKey}:`, error);
      throw error;
    }
  }

  public async getOperations(params: OperationsQuery) {
    const { publicKey, limit = 20, cursor, order = 'desc' } = params;
    if (!publicKey) throw new Error('publicKey is required');

    let builder = server.operations().forAccount(publicKey).limit(limit).order(order);
    if (cursor) builder = builder.cursor(cursor);

    const ops = await builder.call();

    const records = ops.records.map((op: any) => {
      const base = {
        id: op.id,
        createdAt: op.created_at,
        type: op.type,
        source: op.source_account,
        transactionHash: op.transaction_hash,
      };

      switch (op.type) {
        case 'payment':
          return {
            ...base,
            action: op.from === publicKey ? 'sent' : 'received',
            from: op.from,
            to: op.to,
            amount: op.amount,
            asset:
              op.asset_type === 'native'
                ? 'Pi'
                : `${op.asset_code}:${op.asset_issuer}`,
          };

        case 'create_account':
          return {
            ...base,
            action: op.funder === publicKey ? 'created account' : 'account created for me',
            funder: op.funder,
            account: op.account,
            startingBalance: op.starting_balance,
          };

        case 'change_trust':
          return {
            ...base,
            action: op.limit === '0' ? 'removed trustline' : 'added trustline',
            asset: `${op.asset_code}:${op.asset_issuer}`,
            limit: op.limit,
          };

        case 'manage_sell_offer':
        case 'manage_buy_offer':
        case 'create_passive_sell_offer':
          return {
            ...base,
            action: 'managed offer',
            selling:
              op.selling_asset_type === 'native'
                ? 'Pi'
                : `${op.selling_asset_code}:${op.selling_asset_issuer}`,
            buying:
              op.buying_asset_type === 'native'
                ? 'Pi'
                : `${op.buying_asset_code}:${op.buying_asset_issuer}`,
            amount: op.amount,
            price: op.price,
          };

        case 'set_options':
          return {
            ...base,
            action: 'updated account options',
            signer: op.signer_key || null,
            masterWeight: op.master_weight || null,
            lowThreshold: op.low_threshold || null,
            medThreshold: op.med_threshold || null,
            highThreshold: op.high_threshold || null,
          };

        case 'account_merge':
          return {
            ...base,
            action:
              op.into === publicKey
                ? 'received merged account'
                : 'merged into another account',
            destination: op.into,
          };

        default:
          return { ...base, action: `unknown (${op.type})`, details: op };
      }
    });

    const nextCursor = records.length
      ? records[records.length - 1].paging_token
      : null;

    return {
      data: records,
      pagination: {
        limit,
        nextCursor,
        hasMore: Boolean(nextCursor),
        order,
      },
    };
  }
}


