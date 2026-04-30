import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPriceAlert extends Document {
  symbol: string;
  type: 'above' | 'below';
  targetPrice?: number;
  targetPercent?: number;
  referencePrice: number;
  triggered: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PriceAlertSchema = new Schema<IPriceAlert>(
  {
    symbol:         { type: String, required: true },
    type:           { type: String, enum: ['above', 'below'], required: true },
    targetPrice:    { type: Number },
    targetPercent:  { type: Number },
    referencePrice: { type: Number, required: true },
    triggered:      { type: Boolean, default: false },
  },
  { timestamps: true }
);

const PriceAlert: Model<IPriceAlert> =
  mongoose.models.PriceAlert || mongoose.model<IPriceAlert>('PriceAlert', PriceAlertSchema);

export default PriceAlert;
