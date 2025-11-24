import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEncryptedSecret extends Document {
  userId: Types.ObjectId;
  publicKey: string;
  encryptedSecret: string;
  iv: string;
  salt: string;
  createdAt: Date;
  updatedAt: Date;
}

const encryptedSecretSchema = new Schema<IEncryptedSecret>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  publicKey: { type: String, required: true, unique: true },
  encryptedSecret: { type: String, required: true },
  iv: { type: String, required: true },
  salt: { type: String, required: true },
}, {
  timestamps: true
});

// Indexes for better query performance
encryptedSecretSchema.index({ userId: 1 });
// Note: publicKey already has a unique index from unique: true in the schema definition

const EncryptedSecret = mongoose.model<IEncryptedSecret>('EncryptedSecret', encryptedSecretSchema);

export default EncryptedSecret;

