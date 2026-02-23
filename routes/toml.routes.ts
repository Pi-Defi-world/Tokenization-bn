import { Request, Response, Router } from "express";
import Toml from "../models/Toml";

const tomlRoutes = Router();

tomlRoutes.get("/", async (req: Request, res: Response) => {
  try {
    // Pi Wallet expects pi.toml to list all tokens from the issuer
    // We can filter by issuer or assetCode query param
    const issuer = req.query.issuer as string;
    const assetCode = req.query.assetCode as string;

    const query: any = {};
    if (issuer) query.issuer = issuer;
    if (assetCode) query.assetCode = assetCode;

    // If no query params, get all tokens (or you might want to return 400)
    const tokens = await Toml.find(query).lean();

    if (tokens.length === 0) {
      return res.status(404).send('No tokens found');
    }

    const hasValue = (value: any): boolean => {
      return value !== null && value !== undefined && value !== '';
    };

    const formatString = (value: any): string => {
      return `"${value}"`;
    };

    let toml = `NETWORK_PASSPHRASE="${process.env.NETWORK || ''}"
VERSION="2.0.0"
`;

    // Pi Wallet requires each token to have its own [[CURRENCIES]] section
    tokens.forEach((token) => {
      toml += `\n[[CURRENCIES]]\n`;
      toml += `code=${formatString(token.assetCode)}\n`;
      toml += `issuer=${formatString(token.issuer)}\n`;
      
      // REQUIRED fields per Pi Wallet documentation:
      // name: name of token issuer (we use token name, but should be issuer name)
      toml += `name=${formatString(token.name)}\n`;
      
      // desc: REQUIRED - description of the token
      toml += `desc=${formatString(token.description || 'No description available')}\n`;
      
      // image: REQUIRED - icon of the token
      toml += `image=${formatString(token.imgUrl || 'https://via.placeholder.com/64')}\n`;
      
      // Optional fields
      if (token.displayDecimals !== undefined) {
        toml += `display_decimals=${token.displayDecimals}\n`;
      }
      if (token.totalSupply !== undefined) {
        toml += `fixed_number=${token.totalSupply}\n`;
      }
      if (token.isAssetAnchored !== undefined) {
        toml += `is_asset_anchored=${token.isAssetAnchored}\n`;
      }
      if (hasValue(token.anchorAssetType)) {
        toml += `anchor_asset_type=${formatString(token.anchorAssetType)}\n`;
      }
      if (hasValue(token.conditions) && token.conditions !== 'N/A') {
        toml += `conditions=${formatString(token.conditions)}\n`;
      }
      if (hasValue(token.status) && token.status !== 'live') {
        toml += `status=${formatString(token.status)}\n`;
      }
      if (hasValue(token.redemptionInstructions) && token.redemptionInstructions !== 'N/A') {
        toml += `redemption_instructions=${formatString(token.redemptionInstructions)}\n`;
      }
    });

    // Add organization info from first token (assuming all tokens from same issuer)
    const firstToken = tokens[0];
    const hasOrgInfo =
      hasValue(firstToken.orgName) ||
      hasValue(firstToken.orgUrl) ||
      hasValue(firstToken.orgDescription);

    if (hasOrgInfo) {
      toml += `\n\n[ORGANIZATION]`;

      if (hasValue(firstToken.orgName)) {
        toml += `\nname=${formatString(firstToken.orgName)}`;
      }

      if (hasValue(firstToken.orgUrl)) {
        toml += `\nurl=${formatString(firstToken.orgUrl)}`;
      }

      if (hasValue(firstToken.orgDescription)) {
        toml += `\ndescription=${formatString(firstToken.orgDescription)}`;
      }
    }

    // Pi Wallet requires Content-Type: text/plain
    res.setHeader('Content-Type', 'text/plain');
    res.send(toml.trim());
  } catch (error) {
    res.status(500).send('Failed to generate pi.toml');
  }
});

export default tomlRoutes;