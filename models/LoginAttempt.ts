import mongoose, { Schema, Document } from 'mongoose';

export interface ILoginAttempt extends Document {
  identifier: string; // IP address or username/uid
  type: 'ip' | 'username' | 'uid'; // Type of identifier
  attempts: number; // Number of failed attempts
  lastAttempt: Date; // Last attempt timestamp
  lockedUntil?: Date; // Account locked until this time
  createdAt: Date;
  updatedAt: Date;
}

const loginAttemptSchema = new Schema<ILoginAttempt>({
  identifier: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['ip', 'username', 'uid'],
    required: true
  },
  attempts: {
    type: Number,
    default: 0,
    min: 0
  },
  lastAttempt: {
    type: Date,
    default: Date.now
  },
  lockedUntil: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound index for efficient lookups
loginAttemptSchema.index({ identifier: 1, type: 1 }, { unique: true });
loginAttemptSchema.index({ lockedUntil: 1 }); // For finding locked accounts
loginAttemptSchema.index({ lastAttempt: 1 }); // For cleanup queries

// TTL index to auto-delete old login attempts (after 24 hours of inactivity)
loginAttemptSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 });

const LoginAttempt = mongoose.model<ILoginAttempt>('LoginAttempt', loginAttemptSchema);

export default LoginAttempt;

