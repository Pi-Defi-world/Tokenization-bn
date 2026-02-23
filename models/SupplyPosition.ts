import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISupplyPosition extends Document {
  _id: Types.ObjectId;
  userId: string;
  poolId: Types.ObjectId;
  amount: string;
  accruedInterest?: string;
  createdAt: Date;
  updatedAt: Date;
}

const supplyPositionSchema = new Schema<ISupplyPosition>(
  {
    userId: { type: String, required: true, index: true },
    poolId: { type: Schema.Types.ObjectId, ref: 'LendingPool', required: true, index: true },
    amount: { type: String, required: true },
    accruedInterest: { type: String },
  },
  { timestamps: true }
);

supplyPositionSchema.index({ userId: 1, poolId: 1 }, { unique: true });

export const SupplyPosition = mongoose.model<ISupplyPosition>('SupplyPosition', supplyPositionSchema);
