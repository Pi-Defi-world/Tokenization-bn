import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDividendHolderSnapshot extends Document {
  _id: Types.ObjectId;
  dividendRoundId: Types.ObjectId;
  publicKey: string;
  userId?: string;
  tokenBalance: string;
  shareOfSupply: string;
  payoutAmount: string;
  claimedAt?: Date;
  txHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const dividendHolderSnapshotSchema = new Schema<IDividendHolderSnapshot>(
  {
    dividendRoundId: { type: Schema.Types.ObjectId, ref: 'DividendRound', required: true, index: true },
    publicKey: { type: String, required: true, index: true },
    userId: { type: String },
    tokenBalance: { type: String, required: true },
    shareOfSupply: { type: String, required: true },
    payoutAmount: { type: String, required: true },
    claimedAt: { type: Date },
    txHash: { type: String },
  },
  { timestamps: true }
);

dividendHolderSnapshotSchema.index({ dividendRoundId: 1, publicKey: 1 }, { unique: true });

export const DividendHolderSnapshot = mongoose.model<IDividendHolderSnapshot>(
  'DividendHolderSnapshot',
  dividendHolderSnapshotSchema
);
