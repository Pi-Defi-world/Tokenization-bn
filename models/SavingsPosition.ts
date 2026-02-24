import mongoose, { Schema, Document, Types } from 'mongoose';

export type SavingsPositionStatus = 'locked' | 'withdrawn';

export interface ISavingsPosition extends Document {
  _id: Types.ObjectId;
  userId: string;
  productId: Types.ObjectId;
  amount: string;
  /** Exact time of deposit; used for interest display and unlock. */
  depositedAt?: Date;
  unlockedAt: Date;
  status: SavingsPositionStatus;
  interestAccrued?: string;
  /** APY at lock time (from product or indices); used for interest calculation. */
  apyAtDeposit?: string;
  createdAt: Date;
  updatedAt: Date;
}

const savingsPositionSchema = new Schema<ISavingsPosition>(
  {
    userId: { type: String, required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'SavingsProduct', required: true, index: true },
    amount: { type: String, required: true },
    depositedAt: { type: Date },
    unlockedAt: { type: Date, required: true },
    apyAtDeposit: { type: String },
    status: {
      type: String,
      enum: ['locked', 'withdrawn'],
      default: 'locked',
      index: true,
    },
    interestAccrued: { type: String },
  },
  { timestamps: true }
);

savingsPositionSchema.index({ userId: 1, status: 1 });

export const SavingsPosition = mongoose.model<ISavingsPosition>('SavingsPosition', savingsPositionSchema);
