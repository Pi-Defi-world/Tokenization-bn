import { Launch, ILaunch, canTransitionLaunchStatus, LaunchStatus } from '../models/Launch';
import { logger } from '../utils/logger';

export class LaunchService {
  async create(data: {
    projectId: string;
    projectAppUrl?: string;
    teamVestingSchedule?: string;
    tokenAsset: { code: string; issuer: string };
    T_available: string;
    stakeDurationDays?: number;
    allocationDesign?: 1 | 2;
    createdBeforeCutoff?: boolean;
  }): Promise<ILaunch> {
    if (!data.projectAppUrl?.trim()) {
      throw new Error('Product-first policy: projectAppUrl is required (launch must be tied to a project with a working app)');
    }
    const launch = await Launch.create({
      projectId: data.projectId,
      projectAppUrl: data.projectAppUrl,
      teamVestingSchedule: data.teamVestingSchedule,
      tokenAsset: data.tokenAsset,
      T_available: data.T_available,
      stakeDurationDays: data.stakeDurationDays ?? 30,
      allocationDesign: data.allocationDesign ?? 1,
      createdBeforeCutoff: data.createdBeforeCutoff ?? true,
      status: 'draft',
    });
    logger.info(`Launch created: ${launch._id}`);
    return launch;
  }

  async getById(launchId: string): Promise<ILaunch | null> {
    return Launch.findById(launchId).exec();
  }

  async getByStatus(status: LaunchStatus): Promise<ILaunch[]> {
    return Launch.find({ status }).exec();
  }

  async list(limit: number = 50, status?: LaunchStatus): Promise<ILaunch[]> {
    const q = status ? { status } : {};
    return Launch.find(q).sort({ createdAt: -1 }).limit(limit).exec();
  }

  async transitionStatus(launchId: string, newStatus: LaunchStatus): Promise<ILaunch> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    const current = launch.status as LaunchStatus;
    if (!canTransitionLaunchStatus(current, newStatus)) {
      throw new Error(`Invalid transition from ${current} to ${newStatus}`);
    }
    launch.status = newStatus;
    if (newStatus === 'participation_open') {
      if (!launch.projectAppUrl?.trim()) {
        throw new Error('Product-first policy: projectAppUrl must be set before opening participation');
      }
      if (launch.participationWindowStart == null) {
        launch.participationWindowStart = new Date();
        const end = new Date(launch.participationWindowStart);
        end.setDate(end.getDate() + (launch.stakeDurationDays ?? 30));
        launch.participationWindowEnd = end;
      }
    }
    if (newStatus === 'tge_open') {
      launch.tgeAt = new Date();
    }
    await launch.save();
    logger.info(`Launch ${launchId} transitioned to ${newStatus}`);
    return launch;
  }

  async updatePoolAndEscrow(
    launchId: string,
    data: { poolId?: string; escrowPublicKey?: string; listingPrice?: string }
  ): Promise<ILaunch> {
    const launch = await Launch.findByIdAndUpdate(
      launchId,
      { $set: data },
      { new: true }
    ).exec();
    if (!launch) throw new Error('Launch not found');
    return launch;
  }

  isParticipationOpen(launch: ILaunch): boolean {
    return launch.status === 'participation_open';
  }

  isTgeOpen(launch: ILaunch): boolean {
    return launch.status === 'tge_open';
  }

  canTrade(launch: ILaunch): boolean {
    return this.isTgeOpen(launch);
  }

  /** For TGE guard: get launch by poolId. Returns null if pool is not a launchpad pool. */
  async getLaunchByPoolId(poolId: string): Promise<ILaunch | null> {
    return Launch.findOne({ poolId }).exec();
  }
}
