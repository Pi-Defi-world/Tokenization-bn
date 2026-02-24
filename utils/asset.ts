
import * as StellarSdk from "@stellar/stellar-sdk";

export type HorizonServer = StellarSdk.Horizon.Server;

/**
 * Check if a credit asset exists on-chain (at least one account has a trustline).
 * Native asset always returns true.
 */
export async function assetExistsOnChain(
  server: HorizonServer,
  asset: { code: string; issuer: string }
): Promise<boolean> {
  if (asset.code === "native" || !asset.issuer) return true;
  try {
    const stellarAsset = new StellarSdk.Asset(asset.code.trim(), asset.issuer.trim());
    const page = await server.accounts().forAsset(stellarAsset).limit(1).call();
    return page.records.length > 0;
  } catch {
    return false;
  }
}

export function getAssetFromCodeIssuer(input: string | { code: string; issuer?: string }): StellarSdk.Asset {
  if (!input) throw new Error("asset required");

  if (typeof input === "string") {
    const s = input.trim();
    if (s === "native" || s.toLowerCase() === "native") {
      return StellarSdk.Asset.native();
    }
    if (s.includes(":")) {
      const [code, issuer] = s.split(":");
      if (!issuer) throw new Error("issuer required for non-native asset");
      // Preserve original case - Pi Network asset codes are case-sensitive and must match exactly what's on the network
      // The SDK and Horizon API will handle the matching correctly
      return new StellarSdk.Asset(code.trim(), issuer.trim());
    }
    
    throw new Error("Non-native asset requires CODE:ISSUER format (e.g. GAMEFI2:GB... )");
  } else {
    if (input.code === "native" || input.code.toLowerCase() === "native") return StellarSdk.Asset.native();
    if (!input.issuer) throw new Error("issuer required for non-native asset object");
    // Preserve original case - Pi Network asset codes are case-sensitive
    return new StellarSdk.Asset(input.code.trim(), input.issuer.trim());
  }
}
