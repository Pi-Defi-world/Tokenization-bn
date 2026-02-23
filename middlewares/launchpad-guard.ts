import { LaunchService } from '../services/launch.service';

const launchService = new LaunchService();

/**
 * If the given poolId belongs to a launchpad launch, ensure the launch is TGE-open.
 * Use before swap, addLiquidity, removeLiquidity for that pool.
 * @returns null if allowed; error message if not allowed
 */
export async function ensureTgeOpenForPool(poolId: string): Promise<string | null> {
  const launch = await launchService.getLaunchByPoolId(poolId);
  if (!launch) return null; // not a launchpad pool, allow
  if (launch.status === 'tge_open') return null; // allowed
  return `Pool is part of launchpad launch; trading and liquidity only allowed after TGE (current status: ${launch.status})`;
}
