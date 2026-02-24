import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAssetRef {
  code: string;
  issuer: string;
}

export interface ITermOption {
  days: number;
  apy?: string;
}

export interface ISavingsProduct extends Document {
  _id: Types.ObjectId;
  asset: IAssetRef;
  termDays: number;
  apy: string;
  /** If set, product supports multiple terms; each option can have fixed apy or use algorithm. */
  termOptions?: ITermOption[];
  minAmount: string;
  active: boolean;
  source?: 'lending_pool' | 'incentive';
  lendingPoolId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const savingsProductSchema = new Schema<ISavingsProduct>(
  {
    asset: {
      code: { type: String, required: true },
      issuer: { type: String, required: false, default: '' },
    },
    termDays: { type: Number, required: true },
    apy: { type: String, required: true },
    termOptions: [{ days: { type: Number }, apy: { type: String } }],
    minAmount: { type: String, required: true, default: '0' },
    active: { type: Boolean, default: true, index: true },
    source: { type: String, enum: ['lending_pool', 'incentive'] },
    lendingPoolId: { type: Schema.Types.ObjectId, ref: 'LendingPool' },
  },
  { timestamps: true }
);

savingsProductSchema.index({ asset: 1, termDays: 1 });

export const SavingsProduct = mongoose.model<ISavingsProduct>('SavingsProduct', savingsProductSchema);
