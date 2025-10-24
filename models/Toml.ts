import mongoose from 'mongoose';
import { IToml } from '../types';


const tomlSchema = new mongoose.Schema<IToml>({
  assetCode: { type: String, required: true, unique: true },
  issuer: { type: String, required: true },
  distribution: { type: String },

  name: { type: String, required: true },
  description: { type: String },
  imgUrl: { type: String },
  totalSupply: { type: Number, required: true },

  network: { type: String, default: 'Pi Testnet' },

  conditions: { type: String, default: 'N/A' },
  status: { type: String, default: 'live' },
  anchorAssetType: { type: String, default: 'other' },
  displayDecimals: { type: Number, default: 2 },
  isAssetAnchored: { type: Boolean, default: false },
  redemptionInstructions: { type: String, default: 'N/A' },

  orgName: { type: String, default: 'ZyraPay Network' },
  orgUrl: { type: String, default: 'https://www.zyrapay.net' },
  orgDescription: {
    type: String,
    default:
      'ZyraPay is a digital payment platform built on the Pi Network testnet for experimenting with Stellar-based assets.',
  },
},{
  timestamps: true
});

const Toml = mongoose.model<IToml>('Toml', tomlSchema);

export default Toml
