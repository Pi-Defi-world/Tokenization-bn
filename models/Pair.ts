import { Schema, model, Document } from 'mongoose';

export interface IPair extends Document {
  baseToken: string;
  quoteToken: string;
  poolId: string;
  verified: boolean;
  source: 'internal' | 'external';
  createdAt: Date;
  updatedAt: Date;
}

const PairSchema = new Schema<IPair>(
  {
    baseToken: { type: String, required: true },
    quoteToken: { type: String, required: true },
    poolId: { type: String, required: true, unique: true },
    verified: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ['internal', 'external'],
      default: 'internal',
    },
  },
  { timestamps: true }
);

export const Pair = model<IPair>('Pair', PairSchema);
