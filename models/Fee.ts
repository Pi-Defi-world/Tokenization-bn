
import { Schema, model, Document } from 'mongoose';

export interface IFeeConfig extends Document {
  key: string;
  description?: string;
  value: any;
  currency: 'PI' | 'ZYRAPAY'
  isActive: boolean;
}

const FeeConfigSchema = new Schema<IFeeConfig>(
  {
    key: { type: String, required: true, unique: true },
    description: { type: String },
    value: { type: Schema.Types.Mixed, required: true },
    currency: { type: String, enum: ['PI', 'ZYRAPAY'], default: 'PI' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const FeeConfig = model<IFeeConfig>('FeeConfig', FeeConfigSchema);
