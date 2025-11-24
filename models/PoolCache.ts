import mongoose, { Schema, Document } from 'mongoose';

export interface IPoolCache extends Document {
  cacheKey: string;  
  pools: any[];
  lastFetched: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const poolCacheSchema = new Schema<IPoolCache>({
  cacheKey: { 
    type: String, 
    required: true, 
    unique: true
  },
  pools: [{ type: Schema.Types.Mixed }],
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
poolCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes for common query patterns (optimized for performance)
poolCacheSchema.index({ cacheKey: 1, expiresAt: 1 }); // For cache lookups (most common query)
poolCacheSchema.index({ cacheKey: 1 }); // Unique index for fast lookups (already unique, but explicit index helps)

const PoolCache = mongoose.model<IPoolCache>('PoolCache', poolCacheSchema);

export default PoolCache;

