import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IWatchlistItem extends Document {
  symbol: string;
  targetBuyPrice: number;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const WatchlistItemSchema = new Schema<IWatchlistItem>(
  {
    symbol:         { type: String, required: true },
    targetBuyPrice: { type: Number, required: true },
    notes:          { type: String, default: '' },
  },
  { timestamps: true }
);

const WatchlistItem: Model<IWatchlistItem> =
  mongoose.models.WatchlistItem || mongoose.model<IWatchlistItem>('WatchlistItem', WatchlistItemSchema);

export default WatchlistItem;
