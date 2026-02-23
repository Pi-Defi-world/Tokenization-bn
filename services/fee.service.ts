
import { FeeConfig } from '../models/Fee';
import { logger } from '../utils/logger';

export class FeeService {
  async createFee(data: any) {
    const exists = await FeeConfig.findOne({ key: data.key });
    if (exists) throw new Error(`Fee with key "${data.key}" already exists`);
    const fee = await FeeConfig.create(data);
    logger.success(`✅ Fee created: ${fee.key}`);
    return fee;
  }

  async getFees() {
    return FeeConfig.find().sort({ createdAt: -1 });
  }

  async updateFee(key: string, updates: any) {
    const fee = await FeeConfig.findOneAndUpdate({ key }, updates, { new: true });
    if (!fee) throw new Error(`Fee with key "${key}" not found`);
    logger.success(`✅ Fee updated: ${fee.key}`);
    return fee;
  }

  async getFee(key: string) {
    const fee = await FeeConfig.findOne({ key, isActive: true });
    if (!fee) throw new Error(`Fee "${key}" not found or inactive`);
    return fee;
  }

  async deleteFee(key: string) {
    const fee = await FeeConfig.findOneAndDelete({ key });
    if (!fee) throw new Error(`Fee with key "${key}" not found`);
    logger.info(`🗑️ Deleted fee: ${key}`);
    return fee;
  }
}

export const feeService = new FeeService();
