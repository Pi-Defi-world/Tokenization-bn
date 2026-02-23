import mongoose, { Schema, Document } from 'mongoose';

export interface ITransactionCache extends Document {
  publicKey: string;
  cursor: string; // Cache key includes cursor for pagination
  transactions: any[];
  lastFetched: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const transactionCacheSchema = new Schema<ITransactionCache>({
  publicKey: { 
    type: String, 
    required: true
  },
  cursor: {
    type: String,
    default: '' // Empty string for first page
  },
  transactions: [{ type: Schema.Types.Mixed }],
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
transactionCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes for common query patterns (optimized for performance)
transactionCacheSchema.index({ publicKey: 1, cursor: 1, expiresAt: 1 }); // For cache lookups
transactionCacheSchema.index({ publicKey: 1, expiresAt: 1 }); // For cache cleanup

const TransactionCache = mongoose.model<ITransactionCache>('TransactionCache', transactionCacheSchema);

export default TransactionCache;

