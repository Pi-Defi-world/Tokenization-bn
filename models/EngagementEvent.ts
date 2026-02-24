import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEngagementEvent extends Document {
  _id: Types.ObjectId;
  launchId: Types.ObjectId;
  userId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  at: Date;
  createdAt: Date;
}

const engagementEventSchema = new Schema<IEngagementEvent>(
  {
    launchId: { type: Schema.Types.ObjectId, ref: 'Launch', required: true, index: true },
    userId: { type: String, required: true, index: true },
    eventType: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

engagementEventSchema.index({ launchId: 1, userId: 1, at: -1 });

export const EngagementEvent = mongoose.model<IEngagementEvent>('EngagementEvent', engagementEventSchema);
