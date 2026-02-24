import mongoose, { Schema, Document, Types } from 'mongoose';

export type LaunchStatus =
  | 'draft'
  | 'participation_open'
  | 'participation_closed'
  | 'allocation_running'
  | 'tge_open';

export type AllocationDesign = 1 | 2;

export interface ITokenAsset {
  code: string;
  issuer: string;
}

export interface ILaunch extends Document {
  _id: Types.ObjectId;
  projectId: string;
  projectAppUrl?: string;
  teamVestingSchedule?: string;
  tokenAsset: ITokenAsset;
  T_available: string;
  participationWindowStart?: Date;
  participationWindowEnd?: Date;
  stakeDurationDays: number;
  allocationDesign: AllocationDesign;
  status: LaunchStatus;
  escrowPublicKey?: string;
  escrowLocked?: boolean;
  poolId?: string;
  tgeAt?: Date;
  listingPrice?: string;
  PiPowerBaseline?: string;
  createdBeforeCutoff: boolean;
  isEquityStyle?: boolean;
  dividendPolicy?: {
    type: 'percent_of_revenue' | 'fixed_per_token';
    value: string;
    frequency: 'quarterly' | 'monthly' | 'manual';
  };
  createdAt: Date;
  updatedAt: Date;
}

const LAUNCH_STATUS_VALID_TRANSITIONS: Record<LaunchStatus, LaunchStatus[]> = {
  draft: ['participation_open'],
  participation_open: ['participation_closed'],
  participation_closed: ['allocation_running'],
  allocation_running: ['tge_open'],
  tge_open: [],
};

export function canTransitionLaunchStatus(from: LaunchStatus, to: LaunchStatus): boolean {
  return LAUNCH_STATUS_VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

const launchSchema = new Schema<ILaunch>(
  {
    projectId: { type: String, required: true, index: true },
    projectAppUrl: { type: String },
    teamVestingSchedule: { type: String },
    tokenAsset: {
      code: { type: String, required: true },
      issuer: { type: String, required: true },
    },
    T_available: { type: String, required: true },
    participationWindowStart: { type: Date },
    participationWindowEnd: { type: Date },
    stakeDurationDays: { type: Number, required: true, default: 30 },
    allocationDesign: { type: Number, enum: [1, 2], default: 1 },
    status: {
      type: String,
      enum: ['draft', 'participation_open', 'participation_closed', 'allocation_running', 'tge_open'],
      default: 'draft',
      index: true,
    },
    escrowPublicKey: { type: String },
    escrowLocked: { type: Boolean, default: false },
    poolId: { type: String },
    tgeAt: { type: Date },
    listingPrice: { type: String },
    PiPowerBaseline: { type: String },
    createdBeforeCutoff: { type: Boolean, default: true },
    isEquityStyle: { type: Boolean, default: false },
    dividendPolicy: {
      type: { type: String, enum: ['percent_of_revenue', 'fixed_per_token'] },
      value: { type: String },
      frequency: { type: String, enum: ['quarterly', 'monthly', 'manual'] },
    },
  },
  { timestamps: true }
);

launchSchema.index({ poolId: 1 });

export const Launch = mongoose.model<ILaunch>('Launch', launchSchema);
