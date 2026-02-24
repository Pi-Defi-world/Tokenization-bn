import { Participation } from '../models/Participation';
import type { IParticipation } from '../models/Participation';
import { Launch } from '../models/Launch';
import type { IStakingAdapter } from './staking-adapter';
import { logger } from '../utils/logger';

function addStrings(a: string, b: string): string {
  return (parseFloat(a) + parseFloat(b)).toFixed(7);
}

function mulStrings(a: string, b: string): string {
  return (parseFloat(a) * parseFloat(b)).toFixed(7);
}

export class StakingService {
  constructor(private readonly adapter: IStakingAdapter) {}

  /**
   * PiPower_i = T_available * (StakedPi_i / sumStakedPi + PiPower_Baseline)
   * Baseline is 0 if user does not qualify.
   */
  async computePiPower(
    launchId: string,
    userId: string,
    T_available: string,
    PiPowerBaseline: string | undefined,
    qualifiesForBaseline: boolean
  ): Promise<{ piPower: string; stakedPi: string; sumStakedPi: string }> {
    const { stakedPi, sumStakedPi } = await this.adapter.getStakingData(launchId, userId);
    const sum = parseFloat(sumStakedPi) || 1;
    const ratio = parseFloat(stakedPi) / sum;
    const baseline = qualifiesForBaseline && PiPowerBaseline ? parseFloat(PiPowerBaseline) : 0;
    const piPower = mulStrings(T_available, String(ratio + baseline));
    return { piPower, stakedPi, sumStakedPi };
  }

  async getPiPowerForUser(launchId: string, userId: string): Promise<{
    piPower: string;
    stakedPi: string;
    sumStakedPi: string;
    committedPi: string;
    maxCommitmentAllowed: string;
  }> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    const { stakedPi, sumStakedPi, qualifiesForBaseline } = await this.adapter.getStakingData(
      launchId,
      userId
    );
    const { piPower } = await this.computePiPower(
      launchId,
      userId,
      launch.T_available,
      launch.PiPowerBaseline,
      qualifiesForBaseline
    );
    const participation = await Participation.findOne({ launchId, userId }).exec();
    const committedPi = participation?.committedPi ?? '0';
    return {
      piPower,
      stakedPi,
      sumStakedPi,
      committedPi,
      maxCommitmentAllowed: piPower,
    };
  }

  async commitPi(
    launchId: string,
    userId: string,
    committedPi: string
  ): Promise<{ participation: IParticipation }> {
    const launch = await Launch.findById(launchId).exec();
    if (!launch) throw new Error('Launch not found');
    if (launch.status !== 'participation_open') {
      throw new Error('Participation window is not open');
    }

    const { stakedPi, sumStakedPi, qualifiesForBaseline } = await this.adapter.getStakingData(
      launchId,
      userId
    );
    const { piPower } = await this.computePiPower(
      launchId,
      userId,
      launch.T_available,
      launch.PiPowerBaseline,
      qualifiesForBaseline
    );

    const amount = parseFloat(committedPi);
    if (isNaN(amount) || amount <= 0) throw new Error('Invalid committed Pi amount');
    if (amount > parseFloat(piPower)) {
      throw new Error(`Commitment exceeds PiPower cap: ${piPower}`);
    }

    let participation = await Participation.findOne({ launchId, userId }).exec();
    if (!participation) {
      participation = await Participation.create({
        launchId,
        userId,
        stakedPi,
        committedPi: '0',
        piPower,
      });
    }

    const newCommitted = addStrings(participation.committedPi, committedPi);
    if (parseFloat(newCommitted) > parseFloat(piPower)) {
      throw new Error(`Total commitment would exceed PiPower cap: ${piPower}`);
    }

    participation.committedPi = newCommitted;
    participation.stakedPi = stakedPi;
    participation.piPower = piPower;
    await participation.save();

    logger.info(`Commitment recorded: launch=${launchId} user=${userId} committed=${committedPi}`);
    return { participation };
  }
}
