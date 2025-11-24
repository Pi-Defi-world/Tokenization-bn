import mongoose, { Schema, Document } from 'mongoose';

export interface IBalanceCache extends Document {
  publicKey: string;
  balances: any[];
  accountExists: boolean; 
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

// TTL index for automatic expiration
balanceCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes for common query patterns (optimized for performance)
// Note: publicKey already has a unique index from unique: true, so we only add compound indexes
balanceCacheSchema.index({ publicKey: 1, expiresAt: 1 }); // For cache lookups
balanceCacheSchema.index({ accountExists: 1, lastFetched: 1 }); // For background refresh queries

const BalanceCache = mongoose.model<IBalanceCache>('BalanceCache', balanceCacheSchema);

export default BalanceCache;

