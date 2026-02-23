import { Launch } from '../models/Launch';
import { Participation } from '../models/Participation';
import { LaunchService } from './launch.service';
import { EngagementService } from './engagement.service';
import { AllocationService } from './allocation.service';
import { PoolService } from './liquidity-pools.service';
import * as escrowService from './escrow.service';
import { logger } from '../utils/logger';
import type { ILaunch } from '../models/Launch';
import env from '../config/env';

/**
 * Orchestrates launchpad flow: engagement snapshot + allocation when transitioning to allocation_running.
 * Phase 4: escrow creation, LP formation, and permanent lock; then TGE.
 */
export class LaunchpadService {
  private launchService = new LaunchService();
  private engagementService = new EngagementService();
  private allocationService = new AllocationService();
  private poolService = new PoolService();

  /**
   * When transitioning to allocation_running: snapshot engagement (if not already done), run Design 1 allocation, then set status.
   */
  async orchestrateAllocation(launchId: string): Promise<ILaunch> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    if (launch.status !== 'participation_closed') {
      throw new Error('Can only run allocation after participation window is closed');
    }

    const hasRanks = await Participation.findOne({ launchId, engagementRank: { $gt: 0 } }).exec();
    if (!hasRanks) {
      await this.engagementService.snapshotEngagement(launchId);
    }
    if (launch.allocationDesign === 1) {
      await this.allocationService.runDesign1(launchId);
    } else {
      throw new Error('Only Design 1 allocation is implemented');
    }

    const updated = await this.launchService.transitionStatus(launchId, 'allocation_running');
    logger.info(`Launch ${launchId} allocation complete, status=allocation_running`);
    return updated;
  }

  /**
   * Create an escrow keypair for the launch and store its public key.
   * Caller must fund this escrow with C Pi and T tokens, then call formLpAndLock.
   */
  async createEscrow(launchId: string): Promise<{ escrowPublicKey: string; escrowSecret: string }> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    if (launch.status !== 'allocation_running') {
      throw new Error('Escrow can only be created when allocation has run');
    }
    if (launch.escrowPublicKey) {
      throw new Error('Escrow already created for this launch');
    }

    const { publicKey, secretKey } = await escrowService.createEscrowAccount();
    await this.launchService.updatePoolAndEscrow(launchId, {
      escrowPublicKey: publicKey,
    });
    logger.info(`Escrow created for launch ${launchId}: ${publicKey}`);
    return {
      escrowPublicKey: publicKey,
      escrowSecret: secretKey,
    };
  }

  /**
   * Form LP with escrow funds (C Pi + T tokens) and permanently lock the escrow.
   * Requires escrow to already hold C and T; uses escrowSecret only for this call then discards.
   */
  async formLpAndLock(
    launchId: string,
    escrowSecret: string,
    amountC: string,
    amountT: string
  ): Promise<ILaunch> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    if (launch.status !== 'allocation_running') {
      throw new Error('Must be in allocation_running to form LP');
    }
    if (!launch.escrowPublicKey) {
      throw new Error('Create escrow first');
    }

    const piAsset = {
      code: env.PI_ASSET_CODE || 'native',
      issuer: env.PI_ASSET_ISSUER || '',
    };
    const tokenAsset = {
      code: launch.tokenAsset.code,
      issuer: launch.tokenAsset.issuer,
    };

    const result = await this.poolService.createLiquidityPool(
      escrowSecret,
      piAsset.code === 'native' ? { code: 'native', issuer: '' } : piAsset,
      tokenAsset,
      amountC,
      amountT
    );

    try {
      await escrowService.lockEscrowAccount(escrowSecret);
      logger.info(`Escrow locked for launch ${launchId}`);
    } catch (err: any) {
      logger.error('Failed to lock escrow:', err?.message || err);
      throw new Error('Escrow LP formed but lock failed: ' + (err?.message || String(err)));
    }

    await Launch.findByIdAndUpdate(launchId, { $set: { escrowLocked: true } }).exec();
    const listingPrice = (parseFloat(amountC) / parseFloat(amountT)).toFixed(7);
    await this.launchService.updatePoolAndEscrow(launchId, {
      poolId: result.poolId,
      listingPrice,
    });
    const updated = await this.launchService.transitionStatus(launchId, 'tge_open');
    return updated;
  }

  /**
   * Execute full escrow + LP + lock + TGE using total C from participations and T from launch.
   * Use when escrow is already funded (e.g. in test or after off-chain transfers).
   */
  async executeEscrowAndTge(launchId: string, escrowSecret: string): Promise<ILaunch> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');

    const participations = await Participation.find({ launchId }).lean().exec();
    const C = participations
      .reduce((sum, p) => sum + parseFloat(p.committedPi || '0'), 0)
      .toFixed(7);
    const T = launch.T_available;
    return this.formLpAndLock(launchId, escrowSecret, C, T);
  }

  /**
   * Find launch by pool ID (for TGE guards).
   */
  async getLaunchByPoolId(poolId: string): Promise<ILaunch | null> {
    return Launch.findOne({ poolId }).exec();
  }

  /**
   * For Design 2: check if participant's discounted tokens are still locked.
   * Use when transferring allocated tokens; if lockupEnd > now, reject transfer of discounted portion.
   */
  isParticipationLocked(lockupEnd: Date | undefined): boolean {
    if (!lockupEnd) return false;
    return new Date() < new Date(lockupEnd);
  }
}
