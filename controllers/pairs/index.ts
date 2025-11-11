import { Request, Response } from "express";
import { logger } from "../../utils/logger";
import { Pair } from "../../models/Pair";

export const registerPair = async (req: Request, res: Response) => {
  try {
    const { baseToken, quoteToken, poolId } = req.body;
    if (!baseToken || !quoteToken || !poolId )
      return res.status(400).json({ success: false, message: "Missing fields" });

    const existing = await Pair.findOne({ poolId });
    if (existing)
      return res.status(400).json({ success: false, message: "Pair already registered" });

    const pair = await Pair.create({ baseToken, quoteToken, poolId });
    logger.success(`✅ Pair registered: ${baseToken}/${quoteToken}`);
    res.json({ success: true, pair });
  } catch (err: any) {
    logger.error("❌ registerPair failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const verifyPair = async (req: Request, res: Response) => {
  try {
    const { poolId, verified } = req.body;
    if (!poolId)
      return res.status(400).json({ success: false, message: "poolId is required" });

    const pair = await Pair.findOneAndUpdate(
      { poolId },
      { verified: verified ?? true },
      { new: true }
    );

    if (!pair)
      return res.status(404).json({ success: false, message: "Pair not found" });

    logger.success(`✅ Pair ${pair.baseToken}/${pair.quoteToken} verified: ${pair.verified}`);
    res.json({ success: true, pair });
  } catch (err: any) {
    logger.error("❌ verifyPair failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const listPairs = async (req: Request, res: Response) => {
  try {
    const pairs = await Pair.find().sort({ createdAt: -1 });
    res.json({ success: true, pairs });
  } catch (err: any) {
    logger.error("❌ listPairs failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deletePair = async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    if (!poolId)
      return res.status(400).json({ success: false, message: "poolId is required" });

    const deleted = await Pair.findOneAndDelete({ poolId });
    if (!deleted)
      return res.status(404).json({ success: false, message: "Pair not found" });

    logger.info(`🗑️ Deleted pair ${deleted.baseToken}/${deleted.quoteToken}`);
    res.json({ success: true, message: "Pair deleted" });
  } catch (err: any) {
    logger.error("❌ deletePair failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
