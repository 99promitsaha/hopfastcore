import mongoose, { Schema, model } from 'mongoose';

const swapRecordSchema = new Schema(
  {
    userAddress: { type: String, required: true },
    quoteId: { type: String, required: true },
    fromChain: { type: String, required: true },
    toChain: { type: String, required: true },
    fromTokenSymbol: { type: String, required: true },
    toTokenSymbol: { type: String, required: true },
    amount: { type: String, required: true },
    status: { type: String, default: 'quote-created' },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export const SwapRecord = mongoose.models.SwapRecord || model('SwapRecord', swapRecordSchema);
