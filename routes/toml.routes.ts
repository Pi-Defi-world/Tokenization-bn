import { Request, Response, Router } from "express";
import Toml from "../models/Toml";

const tomlRoutes = Router();

tomlRoutes.get("/", async (req: Request, res: Response) => {
  try {
    const assetCode = req.query.assetCode as string;
    if (!assetCode) return res.status(400).send('Missing assetCode query parameter');

    const token = await Toml.findOne({ assetCode }).lean();

    if (!token) return res.status(404).send('Token not found');

    const hasValue = (value: any): boolean => {
      return value !== null && value !== undefined && value !== '';
    };

    const formatString = (value: any): string => {
      return `"${value}"`;
    };

    let toml = `NETWORK_PASSPHRASE="${process.env.NETWORK || ''}"
VERSION="2.0.0"

[[CURRENCIES]]
code=${formatString(token.assetCode)}
issuer=${formatString(token.issuer)}`;

    toml += `
display_decimals=${token.displayDecimals ?? 2}
name=${formatString(token.name)}
fixed_number=${token.totalSupply}
is_asset_anchored=${token.isAssetAnchored ?? false}
anchor_asset_type=${formatString(token.anchorAssetType ?? 'other')}`;

    if (hasValue(token.description)) {
      toml += `\ndesc=${formatString(token.description)}`;
    }

    if (hasValue(token.imgUrl)) {
      toml += `\nimage=${formatString(token.imgUrl)}`;
    }

    if (hasValue(token.conditions) && token.conditions !== 'N/A') {
      toml += `\nconditions=${formatString(token.conditions)}`;
    }

    if (hasValue(token.status) && token.status !== 'live') {
      toml += `\nstatus=${formatString(token.status)}`;
    }

    if (hasValue(token.redemptionInstructions) && token.redemptionInstructions !== 'N/A') {
      toml += `\nredemption_instructions=${formatString(token.redemptionInstructions)}`;
    }

    const hasOrgInfo =
      hasValue(token.orgName) ||
      hasValue(token.orgUrl) ||
      hasValue(token.orgDescription);

    if (hasOrgInfo) {
      toml += `\n\n[ORGANIZATION]`;

      if (hasValue(token.orgName)) {
        toml += `\nname=${formatString(token.orgName)}`;
      }

      if (hasValue(token.orgUrl)) {
        toml += `\nurl=${formatString(token.orgUrl)}`;
      }

      if (hasValue(token.orgDescription)) {
        toml += `\ndescription=${formatString(token.orgDescription)}`;
      }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(toml.trim());
  } catch (error) {
    res.status(500).send('Failed to generate stellar.toml');
  }
});

export default tomlRoutes;