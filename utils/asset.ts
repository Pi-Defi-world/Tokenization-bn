
import * as StellarSdk from "@stellar/stellar-sdk";


export function getAssetFromCodeIssuer(input: string | { code: string; issuer?: string }): StellarSdk.Asset {
  if (!input) throw new Error("asset required");

  if (typeof input === "string") {
    const s = input;
    if (s === "native" || s.toLowerCase() === "native") {
      return StellarSdk.Asset.native();
    }
    if (s.includes(":")) {
      const [code, issuer] = s.split(":");
      if (!issuer) throw new Error("issuer required for non-native asset");
      return new StellarSdk.Asset(code, issuer);
    }
    
    throw new Error("Non-native asset requires CODE:ISSUER format (e.g. GAMEFI2:GB... )");
  } else {
    if (input.code === "native") return StellarSdk.Asset.native();
    if (!input.issuer) throw new Error("issuer required for non-native asset object");
    return new StellarSdk.Asset(input.code, input.issuer);
  }
}
