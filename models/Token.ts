import mongoose, { Document, Schema, Types } from 'mongoose';
import { IToken } from '../types';

const TokenSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    assetCode: { type: String, required: true },
    issuer: { type: String, required: true },
    distributor: { type: String, required: true },
    homeDomain: { type: String, required: false },
    user: { type: Types.ObjectId, ref: "User", required: true },
    description: { type: String, required: true },
    totalSupply: { type: Number, required: true },
  },
  { timestamps: true }
);

const Token = mongoose.model<IToken>('Token', TokenSchema);

export default Token;
