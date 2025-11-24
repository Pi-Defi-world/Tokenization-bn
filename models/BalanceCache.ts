import mongoose, { Schema, Document } from 'mongoose';

export interface IBalanceCache extends Document {
  publicKey: string;
  balances: any[];
  accountExists: boolean; // Track if account exists on network
  lastFetched: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const balanceCacheSchema = new Schema<IBalanceCache>({
  publicKey: { 
    type: String, 
    required: true, 
    unique: true
  },
  balances: [{ type: Schema.Types.Mixed }],
  accountExists: { 
    type: Boolean, 
    default: true
  },
  lastFetched: { 
    type: Date, 
    default: Date.now

  },
  expiresAt: { 
    type: Date, 
    required: true
  }
}, {
  timestamps: true
});

balanceCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

balanceCacheSchema.index({ publicKey: 1, expiresAt: 1 });
balanceCacheSchema.index({ accountExists: 1, lastFetched: 1 });

const BalanceCache = mongoose.model<IBalanceCache>('BalanceCache', balanceCacheSchema);

export default BalanceCache;

