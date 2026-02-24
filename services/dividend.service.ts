import { server, getAsset } from '../config/stellar';
import { applyPayoutFee } from '../config/fees';
import { Launch } from '../models/Launch';
import { DividendRound } from '../models/DividendRound';
import { DividendHolderSnapshot } from '../models/DividendHolderSnapshot';
import { logger } from '../utils/logger';

const PAGE_SIZE = 200;
const MIN_BALANCE = '0';

function mul(a: string, b: string): string {
  return (parseFloat(a) * parseFloat(b)).toFixed(7);
}

function div(a: string, b: string): string {
  const x = parseFloat(a);
  const y = parseFloat(b);
  if (y === 0) return '0';
  return (x / y).toFixed(7);
}

export class DividendService {
  /**
   * Create a dividend round for a launch. Payout asset is always the company token (launch tokenAsset).
   */
  async createRound(
    launchId: string,
    params: { recordAt: Date; totalPayoutAmount: string }
  ): Promise<typeof DividendRound.prototype> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    if (!launch.isEquityStyle) throw new Error('Launch must be equity-style to create dividend rounds');
    if (launch.status !== 'tge_open') throw new Error('Launch must be tge_open');

    const round = await DividendRound.create({
      launchId,
      recordAt: params.recordAt,
      totalPayoutAmount: params.totalPayoutAmount,
      payoutAsset: { code: launch.tokenAsset.code, issuer: launch.tokenAsset.issuer },
      status: 'pending',
    });
    logger.info(`Dividend round created: ${round._id} for launch ${launchId}`);
    return round;
  }

  /**
   * Run snapshot: fetch all holders via server.accounts().forAsset(asset), persist DividendHolderSnapshot.
   */
  async runSnapshot(roundId: string): Promise<{ totalEligibleSupply: string; eligibleHoldersCount: number }> {
    const round = await DividendRound.findById(roundId).exec();
    if (!round) throw new Error('Dividend round not found');
    if (round.status !== 'pending') throw new Error('Round snapshot already run or payout done');

    const launch = await Launch.findById(round.launchId).exec();
    if (!launch) throw new Error('Launch not found');

    const code = round.payoutAsset.code;
    const issuer = round.payoutAsset.issuer;
    const asset = getAsset(code, issuer);

    const holders: { publicKey: string; tokenBalance: string }[] = [];
    let cursor: string | undefined;

    do {
      let builder = server.accounts().forAsset(asset).limit(PAGE_SIZE);
      if (cursor) builder = builder.cursor(cursor);
      const page = await builder.call();

      for (const account of page.records) {
        const acc = account as any;
        const balances = acc.balances || [];
        const bal = balances.find((b: any) => b.asset_code === code && b.asset_issuer === issuer);
        if (!bal) continue;
        const balanceStr = typeof bal.balance === 'string' ? bal.balance : String(bal.balance || '0');
        if (parseFloat(balanceStr) <= parseFloat(MIN_BALANCE)) continue;
        holders.push({ publicKey: acc.id, tokenBalance: balanceStr });
      }

      const hasMore = page.records.length === PAGE_SIZE;
      const lastRecord = page.records[page.records.length - 1] as any;
      cursor = hasMore && lastRecord ? lastRecord.paging_token || lastRecord.id : undefined;
    } while (cursor);

    const totalEligibleSupply = holders
      .reduce((sum, h) => sum + parseFloat(h.tokenBalance), 0)
      .toFixed(7);
    const totalPayout = round.totalPayoutAmount;

    await DividendHolderSnapshot.deleteMany({ dividendRoundId: roundId }).exec();

    for (const { publicKey, tokenBalance } of holders) {
      const shareOfSupply = div(tokenBalance, totalEligibleSupply);
      const grossPayout = mul(shareOfSupply, totalPayout);
      const { netAmount: payoutAmount } = applyPayoutFee(grossPayout);
      await DividendHolderSnapshot.create({
        dividendRoundId: roundId,
        publicKey,
        tokenBalance,
        shareOfSupply,
        payoutAmount,
      });
    }

    round.totalEligibleSupply = totalEligibleSupply;
    round.eligibleHoldersCount = holders.length;
    round.status = 'snapshot_done';
    await round.save();

    logger.info(`Dividend snapshot done: round=${roundId} holders=${holders.length} totalSupply=${totalEligibleSupply}`);
    return { totalEligibleSupply, eligibleHoldersCount: holders.length };
  }

  async getRound(roundId: string) {
    return DividendRound.findById(roundId).populate('launchId').exec();
  }

  async getHolders(roundId: string, limit: number = 50, cursor?: string) {
    const query: Record<string, unknown> = { dividendRoundId: roundId };
    if (cursor) {
      const mongoose = await import('mongoose');
      if (mongoose.Types.ObjectId.isValid(cursor)) {
        query._id = { $gt: new mongoose.Types.ObjectId(cursor) };
      }
    }
    const rows = await DividendHolderSnapshot.find(query).limit(limit).sort({ _id: 1 }).lean().exec();
    const nextCursor = rows.length === limit && rows[rows.length - 1]._id ? String(rows[rows.length - 1]._id) : undefined;
    return { records: rows, nextCursor };
  }

  /**
   * Record claim: company treasury sent company token to holder. Backend sets claimedAt and txHash.
   */
  async recordClaim(
    roundId: string,
    publicKey: string,
    txHash: string
  ): Promise<typeof DividendHolderSnapshot.prototype> {
    const snap = await DividendHolderSnapshot.findOne({ dividendRoundId: roundId, publicKey }).exec();
    if (!snap) throw new Error('Holder snapshot not found');
    if (snap.claimedAt) throw new Error('Already claimed');
    snap.claimedAt = new Date();
    snap.txHash = txHash;
    await snap.save();
    return snap;
  }
}
