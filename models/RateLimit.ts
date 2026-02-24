import mongoose, { Schema, Document } from 'mongoose';

export interface IRateLimit extends Document {
  key: string; // IP or userId-based key
  type: 'ip' | 'user'; // Type of rate limiting
  count: number; // Current request count
  windowStart: Date; // Start of the current window
  windowMs: number; // Window duration in milliseconds
  maxRequests: number; // Maximum requests allowed in window
  createdAt: Date;
  updatedAt: Date;
}

const rateLimitSchema = new Schema<IRateLimit>({
  key: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['ip', 'user'],
    required: true
  },
  count: {
    type: Number,
    default: 0,
    min: 0
  },
  windowStart: {
    type: Date,
    required: true,
    default: Date.now
  },
  windowMs: {
    type: Number,
    required: true
  },
  maxRequests: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

// Compound index for efficient lookups
rateLimitSchema.index({ key: 1, type: 1 }, { unique: true });
rateLimitSchema.index({ windowStart: 1 }); // For cleanup queries

// TTL index to auto-delete expired rate limit entries (after 24 hours of inactivity)
rateLimitSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 });

const RateLimit = mongoose.model<IRateLimit>('RateLimit', rateLimitSchema);

export default RateLimit;

