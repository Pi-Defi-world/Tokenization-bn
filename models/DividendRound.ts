import mongoose, { Schema, Document, Types } from 'mongoose';

export type DividendRoundStatus = 'pending' | 'snapshot_done' | 'payout_done';

export interface IPayoutAsset {
  code: string;
  issuer: string;
}

export interface IDividendRound extends Document {
  _id: Types.ObjectId;
  launchId: Types.ObjectId;
  recordAt: Date;
  status: DividendRoundStatus;
  payoutAsset: IPayoutAsset;
  totalPayoutAmount: string;
  totalEligibleSupply?: string;
  eligibleHoldersCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const dividendRoundSchema = new Schema<IDividendRound>(
  {
    launchId: { type: Schema.Types.ObjectId, ref: 'Launch', required: true, index: true },
    recordAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'snapshot_done', 'payout_done'],
      default: 'pending',
      index: true,
    },
    payoutAsset: {
      code: { type: String, required: true },
      issuer: { type: String, required: true },
    },
    totalPayoutAmount: { type: String, required: true },
    totalEligibleSupply: { type: String },
    eligibleHoldersCount: { type: Number },
  },
  { timestamps: true }
);

export const DividendRound = mongoose.model<IDividendRound>('DividendRound', dividendRoundSchema);
