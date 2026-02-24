import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBorrowPosition extends Document {
  _id: Types.ObjectId;
  userId: string;
  poolId: Types.ObjectId;
  borrowType: 'small' | 'big_business';
  rateYearly: string;
  rateMonthly: string;
  collateralAsset: { code: string; issuer: string };
  collateralAmount: string;
  borrowedAmount: string;
  borrowedAsset: { code: string; issuer: string };
  accruedInterest: string;
  healthFactor: string;
  liquidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const borrowPositionSchema = new Schema<IBorrowPosition>(
  {
    userId: { type: String, required: true, index: true },
    poolId: { type: Schema.Types.ObjectId, ref: 'LendingPool', required: true, index: true },
    collateralAsset: {
      code: { type: String, required: true },
      issuer: { type: String, required: true },
    },
    collateralAmount: { type: String, required: true },
    borrowedAmount: { type: String, required: true },
    borrowedAsset: {
      code: { type: String, required: true },
      issuer: { type: String, required: true },
    },
    borrowType: { type: String, enum: ['small', 'big_business'], required: true },
    rateYearly: { type: String, required: true },
    rateMonthly: { type: String, required: true },
    accruedInterest: { type: String, default: '0' },
    healthFactor: { type: String },
    liquidatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

borrowPositionSchema.index({ userId: 1, poolId: 1 });

export const BorrowPosition = mongoose.model<IBorrowPosition>('BorrowPosition', borrowPositionSchema);
