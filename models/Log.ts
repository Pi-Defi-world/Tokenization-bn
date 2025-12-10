import mongoose, { Schema, Document } from 'mongoose';

export interface ILog extends Document {
  level: 'error' | 'warn' | 'info' | 'success';
  message: string;
  context?: {
    requestId?: string;
    userId?: string;
    ip?: string;
    route?: string;
    method?: string;
    userAgent?: string;
    duration?: number;
  };
  error?: {
    name?: string;
    message?: string;
    stack?: string;
    code?: string;
    status?: number;
  };
  metadata?: Record<string, any>;
  createdAt: Date;
}

const logSchema = new Schema<ILog>({
  level: {
    type: String,
    enum: ['error', 'warn', 'info', 'success'],
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true
  },
  context: {
    requestId: String,
    userId: String,
    ip: String,
    route: String,
    method: String,
    userAgent: String,
    duration: Number
  },
  error: {
    name: String,
    message: String,
    stack: String,
    code: String,
    status: Number
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
logSchema.index({ level: 1, createdAt: -1 }); // For filtering by level and date
logSchema.index({ 'context.requestId': 1 }); // For finding logs by request ID
logSchema.index({ 'context.userId': 1, createdAt: -1 }); // For user-specific logs
logSchema.index({ 'context.route': 1, createdAt: -1 }); // For route-specific logs
logSchema.index({ createdAt: -1 }); // For general date-based queries

// TTL index for automatic log cleanup (default 30 days, configurable via env)
const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
logSchema.index({ createdAt: 1 }, { expireAfterSeconds: retentionDays * 24 * 60 * 60 });

const Log = mongoose.model<ILog>('Log', logSchema);

export default Log;

