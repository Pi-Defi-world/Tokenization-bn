import { Request, Response } from 'express';
import { LaunchService } from '../../services/launch.service';
import { StakingService } from '../../services/staking.service';
import { MockStakingAdapter } from '../../services/staking-adapter';
import { EngagementService } from '../../services/engagement.service';
import { AllocationService } from '../../services/allocation.service';
import { LaunchpadService } from '../../services/launchpad.service';
import { logger } from '../../utils/logger';

const launchService = new LaunchService();
const stakingAdapter = new MockStakingAdapter();
const stakingService = new StakingService(stakingAdapter);
const engagementService = new EngagementService();
const allocationService = new AllocationService();
const launchpadService = new LaunchpadService();

function getLaunchIdParam(req: Request): string {
  const p = req.params.launchId;
  return Array.isArray(p) ? p[0] : p;
}

export const createLaunch = async (req: Request, res: Response) => {
  try {
    const { projectId, projectAppUrl, teamVestingSchedule, tokenAsset, T_available, stakeDurationDays, allocationDesign, createdBeforeCutoff } = req.body || {};
    if (!projectId || !tokenAsset?.code || !tokenAsset?.issuer || !T_available) {
      return res.status(400).json({
        message: 'Missing required fields: projectId, tokenAsset { code, issuer }, T_available',
      });
    }
    if (!projectAppUrl || typeof projectAppUrl !== 'string' || !projectAppUrl.trim()) {
      return res.status(400).json({
        message: 'projectAppUrl is required (product-first: launch must be tied to a project with an app URL)',
      });
    }
    const launch = await launchService.create({
      projectId,
      projectAppUrl: projectAppUrl.trim(),
      teamVestingSchedule,
      tokenAsset: { code: tokenAsset.code, issuer: tokenAsset.issuer },
      T_available: String(T_available),
      stakeDurationDays,
      allocationDesign,
      createdBeforeCutoff,
    });
    return res.status(201).json(launch);
  } catch (error: any) {
    logger.error('createLaunch failed:', error);
    return res.status(500).json({ message: 'Failed to create launch', error: error?.message });
  }
};

export const getLaunch = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    const launch = await launchService.getById(launchId);
    if (!launch) return res.status(404).json({ message: 'Launch not found' });
    return res.status(200).json(launch);
  } catch (error: any) {
    logger.error('getLaunch failed:', error);
    return res.status(500).json({ message: 'Failed to fetch launch' });
  }
};

export const listLaunches = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
    const status = req.query.status as string | undefined;
    const validStatuses = ['draft', 'participation_open', 'participation_closed', 'allocation_running', 'tge_open'];
    const launchStatus = status && validStatuses.includes(status) ? status : undefined;
    const launches = await launchService.list(limit, launchStatus as any);
    return res.status(200).json({ data: launches });
  } catch (error: any) {
    logger.error('listLaunches failed:', error);
    return res.status(500).json({ message: 'Failed to list launches' });
  }
};

export const transitionLaunchStatus = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ message: 'status is required' });
    if (status === 'allocation_running') {
      const launch = await launchpadService.orchestrateAllocation(launchId);
      return res.status(200).json(launch);
    }
    const launch = await launchService.transitionStatus(launchId, status);
    return res.status(200).json(launch);
  } catch (error: any) {
    logger.error('transitionLaunchStatus failed:', error);
    return res.status(400).json({ message: error?.message ?? 'Invalid transition' });
  }
};

export const getMyPiPower = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    const userId = (req as any).user?.uid ?? req.query.userId ?? req.body?.userId;
    if (!userId) return res.status(400).json({ message: 'userId required (or authenticated user)' });
    const data = await stakingService.getPiPowerForUser(launchId, String(userId));
    return res.status(200).json(data);
  } catch (error: any) {
    logger.error('getMyPiPower failed:', error);
    return res.status(500).json({ message: error?.message ?? 'Failed to get PiPower' });
  }
};

export const commitPi = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    const { committedPi, userId: bodyUserId } = req.body || {};
    const userId = (req as any).user?.uid ?? req.query.userId ?? bodyUserId;
    if (!userId) return res.status(400).json({ message: 'userId required (or authenticated user)' });
    if (!committedPi) return res.status(400).json({ message: 'committedPi is required' });
    const { participation } = await stakingService.commitPi(launchId, String(userId), String(committedPi));
    return res.status(200).json({ participation });
  } catch (error: any) {
    logger.error('commitPi failed:', error);
    return res.status(400).json({ message: error?.message ?? 'Failed to commit Pi' });
  }
};

export const postEngagement = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    const { userId, eventType, payload } = req.body || {};
    const uid = (req as any).user?.uid ?? userId;
    if (!uid) return res.status(400).json({ message: 'userId required (or authenticated user)' });
    if (!eventType) return res.status(400).json({ message: 'eventType is required' });
    await engagementService.ingestEvent(launchId, String(uid), eventType, payload);
    return res.status(204).send();
  } catch (error: any) {
    logger.error('postEngagement failed:', error);
    return res.status(400).json({ message: error?.message ?? 'Failed to ingest engagement event' });
  }
};

export const recordEngagement = postEngagement;

export const closeParticipationWindow = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    await launchService.transitionStatus(launchId, 'participation_closed');
    await engagementService.snapshotEngagement(launchId);
    const launch = await launchService.getById(launchId);
    return res.status(200).json(launch);
  } catch (error: any) {
    logger.error('closeParticipationWindow failed:', error);
    return res.status(400).json({ message: error?.message ?? 'Failed to close window' });
  }
};

export const runAllocation = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    const launch = await launchpadService.orchestrateAllocation(launchId);
    return res.status(200).json(launch);
  } catch (error: any) {
    logger.error('runAllocation failed:', error);
    return res.status(400).json({ message: error?.message ?? 'Failed to run allocation' });
  }
};

export const createEscrow = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    const result = await launchpadService.createEscrow(launchId);
    return res.status(201).json(result);
  } catch (error: any) {
    logger.error('createEscrow failed:', error);
    return res.status(400).json({ message: error?.message ?? 'Failed to create escrow' });
  }
};

export const executeEscrowAndTge = async (req: Request, res: Response) => {
  try {
    const launchId = getLaunchIdParam(req);
    const { escrowSecret } = req.body || {};
    if (!escrowSecret) return res.status(400).json({ message: 'escrowSecret is required' });
    const launch = await launchpadService.executeEscrowAndTge(launchId, String(escrowSecret));
    return res.status(200).json(launch);
  } catch (error: any) {
    logger.error('executeEscrowAndTge failed:', error);
    return res.status(400).json({ message: error?.message ?? 'Failed to execute escrow and TGE' });
  }
};
