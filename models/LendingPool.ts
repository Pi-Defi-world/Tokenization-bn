import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAssetRef {
  code: string;
  issuer: string;
}

export interface ICollateralConfig {
  asset: IAssetRef;
  collateralFactor: string;
}

export interface ILendingPool extends Document {
  _id: Types.ObjectId;
  asset: IAssetRef;
  totalSupply: string;
  totalBorrow: string;
  supplyRate: string;
  borrowRate: string;
  collateralFactor: string;
  collateralAssets: ICollateralConfig[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const collateralConfigSchema = new Schema<ICollateralConfig>(
  {
    asset: {
      code: { type: String, required: true },
      issuer: { type: String, required: true },
    },
    collateralFactor: { type: String, required: true },
  },
  { _id: false }
);

const lendingPoolSchema = new Schema<ILendingPool>(
  {
    asset: {
      code: { type: String, required: true },
      issuer: { type: String, required: true },
    },
    totalSupply: { type: String, default: '0' },
    totalBorrow: { type: String, default: '0' },
    supplyRate: { type: String, required: true },
    borrowRate: { type: String, required: true },
    collateralFactor: { type: String, required: true },
    collateralAssets: [collateralConfigSchema],
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const LendingPool = mongoose.model<ILendingPool>('LendingPool', lendingPoolSchema);
