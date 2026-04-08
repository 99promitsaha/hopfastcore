import mongoose, { Schema, model } from 'mongoose';

const intentLogSchema = new Schema(
  {
    prompt: { type: String, required: true },
    result: { type: Schema.Types.Mixed, required: true },
    source: { type: String, required: true }
  },
  { timestamps: true }
);

export const IntentLog = mongoose.models.IntentLog || model('IntentLog', intentLogSchema);
