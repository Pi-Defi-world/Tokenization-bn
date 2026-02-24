import mongoose, { Schema, Document, Types } from 'mongoose';

export type EngagementTier = 'top' | 'mid' | 'bottom';

export interface IParticipation extends Document {
  _id: Types.ObjectId;
  launchId: Types.ObjectId;
  userId: string;
  stakedPi: string;
  committedPi: string;
  piPower: string;
  engagementScore: number;
  engagementRank: number;
  allocatedTokens: string;
  effectivePrice: string;
  tier?: EngagementTier;
  swapOrder?: number;
  lockupEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const participationSchema = new Schema<IParticipation>(
  {
    launchId: { type: Schema.Types.ObjectId, ref: 'Launch', required: true, index: true },
    userId: { type: String, required: true, index: true },
    stakedPi: { type: String, default: '0' },
    committedPi: { type: String, default: '0' },
    piPower: { type: String, default: '0' },
    engagementScore: { type: Number, default: 0 },
    engagementRank: { type: Number, default: 0 },
    allocatedTokens: { type: String, default: '0' },
    effectivePrice: { type: String, default: '0' },
    tier: { type: String, enum: ['top', 'mid', 'bottom'] },
    swapOrder: { type: Number },
    lockupEnd: { type: Date },
  },
  { timestamps: true }
);

participationSchema.index({ launchId: 1, userId: 1 }, { unique: true });

export const Participation = mongoose.model<IParticipation>('Participation', participationSchema);
