/**
 * Staking adapter: returns Pi staking data for a launch.
 * Implement with Pi blockchain or Pi Core Team API when available.
 */
export interface StakingData {
  stakedPi: string;
  sumStakedPi: string;
  qualifiesForBaseline: boolean;
}

export interface IStakingAdapter {
  getStakingData(launchId: string, userId: string): Promise<StakingData>;
}

/**
 * Mock adapter for development. Replace with Pi chain/API implementation.
 */
export class MockStakingAdapter implements IStakingAdapter {
  private store: Map<string, string> = new Map();

  async getStakingData(launchId: string, userId: string): Promise<StakingData> {
    const key = `${launchId}:${userId}`;
    const stakedPi = this.store.get(key) ?? '0';
    const sumStakedPi = this.getSumStakedPiForLaunch(launchId);
    const qualifiesForBaseline = false;
    return { stakedPi, sumStakedPi, qualifiesForBaseline };
  }

  private getSumStakedPiForLaunch(launchId: string): string {
    let sum = 0;
    const prefix = `${launchId}:`;
    for (const [k, v] of this.store) {
      if (k.startsWith(prefix)) sum += parseFloat(v || '0');
    }
    return sum > 0 ? String(sum) : '1';
  }

  setStaked(launchId: string, userId: string, stakedPi: string): void {
    this.store.set(`${launchId}:${userId}`, stakedPi);
  }
}
