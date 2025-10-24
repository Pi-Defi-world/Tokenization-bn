import { Request, Response } from "express";
import { tokenService } from "../../services/token.service";
import { ICreateTokenPayload, IUser } from "../../types";
import { MintTokenParams } from "../../services/token.service";

export const getTokens = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser as IUser;

    // if (!currentUser) {
    //   return res.status(401).json({ success: false, message: "Not authenticated" });
    // }

    const tokens = await tokenService.getTokens();

    return res.json({ success: true, tokens });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const trustline = async (req: Request, res: Response) => {
  try {
    const { userSecret, assetCode, issuer } = req.body;

    if (!userSecret) {
      return res
        .status(400)
        .json({ success: false, message: "User secret is required" });
    }
    if (!assetCode) {
      return res
        .status(400)
        .json({ success: false, message: "Asset code is required" });
    }
    if (!issuer) {
      return res
        .status(400)
        .json({ success: false, message: "Issuer is required" });
    }

    const result = await tokenService.establishTrustline(
      userSecret,
      assetCode,
      issuer
    );

    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};


export const mint = async (req: Request, res: Response) => {
  const currentUser = (req as any).currentUser as IUser;

  try {
    const {
      distributorSecret,
      assetCode,
      totalSupply,
      homeDomain,
      name,
      description,
    } = req.body;

    if (!distributorSecret) {
      return res
        .status(400)
        .json({ success: false, message: "distributorSecret key is required" });
    }
    if (!assetCode) {
      return res
        .status(400)
        .json({ success: false, message: "Asset code is required" });
    }
    if (!totalSupply) {
      return res
        .status(400)
        .json({ success: false, message: "totalSupply is required" });
    }

    const tokenData: ICreateTokenPayload = {
      name,
      description,
      totalSupply,
      user: currentUser._id,
    };


    const mintParams: MintTokenParams = {
      distributorSecret,
      assetCode,
      totalSupply:totalSupply.toString(),
      data: tokenData,
      homeDomain,
    };

    const result = await tokenService.mintToken(mintParams);

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};
