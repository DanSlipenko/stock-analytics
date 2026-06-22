import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAsset extends Document {
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const AssetSchema = new Schema<IAsset>(
  {
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const Asset: Model<IAsset> = mongoose.models.Asset || mongoose.model<IAsset>('Asset', AssetSchema);

export default Asset;
