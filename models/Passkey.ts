import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPasskey extends Document {
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceName: string;
  userId: Types.ObjectId;
  lastUsedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const passkeySchema = new Schema<IPasskey>({
  credentialId: { type: String, required: true, unique: true },
  publicKey: { type: String, required: true },
  counter: { type: Number, default: 0 },
  deviceName: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lastUsedAt: { type: Date },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true
});

// Indexes for better query performance
passkeySchema.index({ userId: 1, isActive: 1 }); // For finding user's active passkeys
passkeySchema.index({ userId: 1, credentialId: 1 }); // For finding specific passkey by user
passkeySchema.index({ lastUsedAt: -1 }); // For sorting by last used
passkeySchema.index({ createdAt: -1 }); // For sorting by creation date

const Passkey = mongoose.model<IPasskey>('Passkey', passkeySchema);

export default Passkey;

