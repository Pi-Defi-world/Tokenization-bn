
import * as StellarSdk from "@stellar/stellar-sdk";


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
      // Preserve original case - Stellar asset codes are case-sensitive and must match exactly what's on the network
      // The Stellar SDK and Horizon API will handle the matching correctly
      return new StellarSdk.Asset(code.trim(), issuer.trim());
    }
    
    throw new Error("Non-native asset requires CODE:ISSUER format (e.g. GAMEFI2:GB... )");
  } else {
    if (input.code === "native" || input.code.toLowerCase() === "native") return StellarSdk.Asset.native();
    if (!input.issuer) throw new Error("issuer required for non-native asset object");
    // Preserve original case - Stellar asset codes are case-sensitive
    return new StellarSdk.Asset(input.code.trim(), input.issuer.trim());
  }
}
