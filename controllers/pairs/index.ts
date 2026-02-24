import { Request, Response } from "express";
import { logger } from "../../utils/logger";
import { Pair } from "../../models/Pair";
import { errorBody, errorBodyFrom } from "../../utils/zyradex-error";

export const registerPair = async (req: Request, res: Response) => {
  try {
    const { baseToken, quoteToken, poolId } = req.body;
    if (!baseToken || !quoteToken || !poolId)
      return res.status(400).json(errorBody("Please provide both tokens and a pool to register."));

    const existing = await Pair.findOne({ poolId });
    if (existing)
      return res.status(400).json(errorBody("This pool is already registered as a pair."));

    const pair = await Pair.create({ baseToken, quoteToken, poolId });
    logger.success(`✅ Pair registered: ${baseToken}/${quoteToken}`);
    res.json({ success: true, pair });
  } catch (err: any) {
    logger.error("❌ registerPair failed:", err);
    return res.status(500).json(errorBodyFrom(err));
  }
};

export const verifyPair = async (req: Request, res: Response) => {
  try {
    const { poolId, verified } = req.body;
    if (!poolId) return res.status(400).json(errorBody("Please provide a pool to verify."));

    const pair = await Pair.findOneAndUpdate(
      { poolId },
      { verified: verified ?? true },
      { new: true }
    );

    if (!pair) return res.status(404).json(errorBody("This pair was not found."));

    logger.success(`✅ Pair ${pair.baseToken}/${pair.quoteToken} verified: ${pair.verified}`);
    res.json({ success: true, pair });
  } catch (err: any) {
    logger.error("❌ verifyPair failed:", err);
    return res.status(500).json(errorBodyFrom(err));
  }
};

export const listPairs = async (req: Request, res: Response) => {
  try {
    const pairs = await Pair.find().sort({ createdAt: -1 });
    res.json({ success: true, pairs });
  } catch (err: any) {
    logger.error("❌ listPairs failed:", err);
    return res.status(500).json(errorBodyFrom(err));
  }
};

export const deletePair = async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    if (!poolId) return res.status(400).json(errorBody("Please specify which pool to remove."));

    const deleted = await Pair.findOneAndDelete({ poolId });
    if (!deleted) return res.status(404).json(errorBody("This pair was not found."));

    logger.info(`🗑️ Deleted pair ${deleted.baseToken}/${deleted.quoteToken}`);
    res.json({ success: true, message: "Pair deleted" });
  } catch (err: any) {
    logger.error("❌ deletePair failed:", err);
    return res.status(500).json(errorBodyFrom(err));
  }
};
