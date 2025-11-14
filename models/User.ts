import mongoose, { Schema, Document, Types } from 'mongoose';
import { IUser } from '../types';

const userSchema = new Schema<IUser>({
  uid: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  public_key: { type: String, required: false, unique: true, sparse: true },
  avatarUrl: { 
    type: String, 
    default: "https://api.dicebear.com/7.x/pixel-art/svg?seed=user"
  },
  tokens: [{ type: Schema.Types.ObjectId, ref: 'Token' }],
  liquidityPools: [{ type: Schema.Types.ObjectId, ref: 'LiquidityPool' }],
  liquidityPoolInvestments: [
    {
      poolId: { type: Schema.Types.ObjectId, ref: 'LiquidityPool', required: true },
      amount: { type: String, required: true },
      lpTokens: { type: String, required: true }
    }
  ],
  role: { type: String, enum: ['user', 'creator', 'admin'], default: 'user' },
  verified: { type: Boolean, default: false },
}, {
  timestamps: true
});

// Index for public_key lookups (sparse index allows null values)
userSchema.index({ public_key: 1 }, { sparse: true, unique: true });

const User = mongoose.model<IUser>('User', userSchema);

export default User;

