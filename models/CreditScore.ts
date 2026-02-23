import mongoose, { Schema, Document, Types } from 'mongoose';

/** Credit score 0-100. Higher = better; used to lower borrow interest. */
export interface ICreditScore extends Document {
  _id: Types.ObjectId;
  userId: string;
  score: number;
  updatedAt: Date;
  createdAt: Date;
}

const creditScoreSchema = new Schema<ICreditScore>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    score: { type: Number, required: true, min: 0, max: 100 },
  },
  { timestamps: true }
);

export const CreditScore = mongoose.model<ICreditScore>('CreditScore', creditScoreSchema);
