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

    // Horizon API's forCode() is case-sensitive, so we need to try multiple case variations
    // Try the exact case first, then uppercase, then lowercase
    const codeVariations = [
      code, // Original case
      code.toUpperCase(), // Uppercase
      code.toLowerCase(), // Lowercase
      code.charAt(0).toUpperCase() + code.slice(1).toLowerCase(), // Title case
    ];
    
    // Remove duplicates
    const uniqueVariations = [...new Set(codeVariations)];
    
    let allAssets: any[] = [];
    const seenAssets = new Set<string>(); // Track by asset_code:issuer to avoid duplicates
    
    for (const codeVar of uniqueVariations) {
      try {
        const response = await server.assets().forCode(codeVar).limit(validLimit).call();
        
        for (const asset of response.records) {
          const assetKey = `${asset.asset_code}:${asset.asset_issuer}`;
          if (!seenAssets.has(assetKey)) {
            seenAssets.add(assetKey);
            allAssets.push({
              asset_type: asset.asset_type,
              asset_code: asset.asset_code,
              asset_issuer: asset.asset_issuer,
              num_accounts: asset.num_accounts,
              num_claimable_balances: asset.num_claimable_balances,
              balances: asset.balances,
              flags: asset.flags,
              paging_token: asset.paging_token,
            });
          }
        }
      } catch (err: any) {
      }
    }

    logger.success(`✅ Found ${allAssets.length} assets for code: ${code} (searched ${uniqueVariations.length} case variations)`);
    return res.json({ success: true, assets: allAssets, count: allAssets.length });
  } catch (err: any) {
    logger.error("❌ searchAssetsHandler error:", err);
    return res.status(500).json({ success: false, message: err.message || err.toString() });
  }
}

