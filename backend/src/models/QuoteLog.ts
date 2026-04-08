import mongoose, { Schema, model } from 'mongoose';

const quoteLogSchema = new Schema(
  {
    requestPayload: { type: Schema.Types.Mixed, required: true },
    quoteId: { type: String },
    route: { type: String },
    provider: { type: String, default: 'lifi' },
    responsePayload: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);

export const QuoteLog = mongoose.models.QuoteLog || model('QuoteLog', quoteLogSchema);
