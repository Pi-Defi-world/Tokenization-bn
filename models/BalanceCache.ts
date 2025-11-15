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
    unique: true,
    index: true 
  },
  balances: { 
    type: [Schema.Types.Mixed], 
    default: [] 
  },
  accountExists: { 
    type: Boolean, 
    default: true,
    index: true 
  },
  lastFetched: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
  expiresAt: { 
    type: Date, 
    required: true,
    index: { expireAfterSeconds: 0 } // TTL index - auto-delete expired entries
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
balanceCacheSchema.index({ publicKey: 1, expiresAt: 1 });
balanceCacheSchema.index({ accountExists: 1, lastFetched: 1 });

const BalanceCache = mongoose.model<IBalanceCache>('BalanceCache', balanceCacheSchema);

export default BalanceCache;

