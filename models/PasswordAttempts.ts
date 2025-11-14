import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPasswordAttempts extends Document {
  userId: Types.ObjectId;
  publicKey: string;
  attempts: number;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const passwordAttemptsSchema = new Schema<IPasswordAttempts>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  publicKey: { type: String, required: true, unique: true },
  attempts: { type: Number, default: 0 },
  lockedUntil: { type: Date },
}, {
  timestamps: true
});

// Indexes for better query performance
passwordAttemptsSchema.index({ userId: 1 });
passwordAttemptsSchema.index({ publicKey: 1 }, { unique: true });

const PasswordAttempts = mongoose.model<IPasswordAttempts>('PasswordAttempts', passwordAttemptsSchema);

export default PasswordAttempts;

