import mongoose, { Schema, Document, Model } from 'mongoose';

// ---- Sub-schemas (defined first, embedded in Campaign) ----

const TransactionSchema = new Schema({
  type:        { type: String, enum: ['sell'], default: 'sell' },
  shares:      { type: Number, required: true },
  price:       { type: Number, required: true },
  date:        { type: Date, default: Date.now },
  percentSold: { type: Number, required: true },
});

const StockNotificationSchema = new Schema({
  type:           { type: String, enum: ['above', 'below'], required: true },
  targetPrice:    { type: Number },
  targetPercent:  { type: Number },
  referencePrice: { type: Number, required: true },
  createdAt:      { type: Date, default: Date.now },
});

const CampaignStockSchema = new Schema({
  symbol:       { type: String, required: true },
  shares:       { type: Number, required: true },
  buyPrice:     { type: Number, required: true },
  buyDate:      { type: Date, default: Date.now },
  locationId:   { type: Schema.Types.ObjectId },
  isStarred:    { type: Boolean, default: false },
  transactions: [TransactionSchema],
  notifications: [StockNotificationSchema],
});

const MoneyLocationSchema = new Schema({
  name:            { type: String, required: true },
  type:            { type: String, enum: ['PayPal', 'Kraken', 'Fidelity Roth Clara', 'Fidelity Roth Dan', 'Fidelity Dan', 'Charles Schwab'], default: 'Fidelity Dan' },
  allocatedAmount: { type: Number, default: 0 },
});

// ---- Main Campaign Schema ----

export interface ICampaign extends Document {
  name: string;
  startDate: Date;
  moneyLocations: Array<{
    _id: mongoose.Types.ObjectId;
    name: string;
    type: string;
    allocatedAmount: number;
  }>;
  stocks: Array<{
    _id: mongoose.Types.ObjectId;
    symbol: string;
    shares: number;
    buyPrice: number;
    buyDate: Date;
    locationId: mongoose.Types.ObjectId;
    isStarred?: boolean;
    transactions: Array<{
      _id: mongoose.Types.ObjectId;
      type: string;
      shares: number;
      price: number;
      date: Date;
      percentSold: number;
    }>;
    notifications?: Array<{
      _id: mongoose.Types.ObjectId;
      type: 'above' | 'below';
      targetPrice?: number;
      targetPercent?: number;
      referencePrice: number;
      createdAt: Date;
    }>;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    name:           { type: String, required: true },
    startDate:      { type: Date, required: true, default: Date.now },
    moneyLocations: [MoneyLocationSchema],
    stocks:         [CampaignStockSchema],
  },
  { timestamps: true }
);

if (mongoose.models.Campaign) {
  delete mongoose.models.Campaign;
}
const Campaign: Model<ICampaign> = mongoose.model<ICampaign>('Campaign', CampaignSchema);

export default Campaign;
