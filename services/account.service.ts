import { server } from '../config/stellar';
import { getKeypairFromMnemonic, getKeypairFromSecret } from '../utils/keypair';

export interface ImportAccountInput {
  mnemonic?: string;
  secret?: string;
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
    const { mnemonic, secret } = input;
    if (!mnemonic && !secret) {
      throw new Error('Provide mnemonic or secret');
    }

    if (mnemonic) {
      const kp = await getKeypairFromMnemonic(mnemonic);
      return { publicKey: kp.publicKey(), secret: kp.secret() };
    }

    const kp = getKeypairFromSecret(secret as string);
    return { publicKey: kp.publicKey(), secret: kp.secret() };
  }

  public async getBalances(publicKey: string) {
    if (!publicKey) {
      throw new Error('publicKey is required');
    }

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


