import { Request, Response } from "express";
import { server } from "../../config/stellar";
import { logger } from "../../utils/logger";

export async function searchAssetsHandler(req: Request, res: Response) {
  try {
    const { code, limit } = req.query;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ success: false, message: "asset code is required" });
    }

    const limitNum = limit ? parseInt(String(limit), 10) : 10;
    const validLimit = isNaN(limitNum) || limitNum <= 0 ? 10 : Math.min(limitNum, 50); // Max 50

    logger.info(`🔎 Searching assets for code: ${code}, limit: ${validLimit}`);

    const response = await server.assets().forCode(code).limit(validLimit).call();

    const assets = response.records.map((asset: any) => ({
      asset_type: asset.asset_type,
      asset_code: asset.asset_code,
      asset_issuer: asset.asset_issuer,
      num_accounts: asset.num_accounts,
      num_claimable_balances: asset.num_claimable_balances,
      balances: asset.balances,
      flags: asset.flags,
      paging_token: asset.paging_token,
    }));

    logger.success(`✅ Found ${assets.length} assets for code: ${code}`);
    return res.json({ success: true, assets, count: assets.length });
  } catch (err: any) {
    logger.error("❌ searchAssetsHandler error:", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}

