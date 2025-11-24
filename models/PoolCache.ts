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

poolCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

poolCacheSchema.index({ cacheKey: 1, expiresAt: 1 });

const PoolCache = mongoose.model<IPoolCache>('PoolCache', poolCacheSchema);

export default PoolCache;

