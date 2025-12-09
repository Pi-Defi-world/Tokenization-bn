import { Request, Response } from "express";
import { tokenService } from "../../services/token.service";
import { ICreateTokenPayload, IUser } from "../../types";
import { MintTokenParams } from "../../services/token.service";

export const getMintFee = async (req: Request, res: Response) => {
  try {
    // Platform fee is always 100 Pi
    const platformFee = "100"; // 100 Pi
    const platformFeeStroops = "1000000000"; // 100 Pi in stroops
    
    // Get base fee from blockchain
    let baseFee = "0.01"; // Default
    try {
      const { server } = await import("../../config/stellar");
      const fetchedFee = await server.fetchBaseFee();
      baseFee = (parseFloat(fetchedFee.toString()) / 10000000).toFixed(7); // Convert stroops to Pi
    } catch (error) {
      // Use default if fetch fails
    }

    return res.json({
      success: true,
      fee: {
        platformFee: platformFee, // 100 Pi
        platformFeeStroops: platformFeeStroops,
        baseFee: baseFee, // Blockchain base fee in Pi
        totalFee: (parseFloat(platformFee) + parseFloat(baseFee)).toFixed(7), // Total in Pi
        feeRecipient: process.env.PI_TEST_USER_PUBLIC_KEY,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getTokens = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser as IUser;
 

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

export const burnTokens = async (req: Request, res: Response) => {
  try {
    const { assetCode, amount, holderSecret,issuer } = req.body;

    if (!assetCode) {
      return res.status(400).json({ success: false, message: "assetCode is required" });
    }
    if (!amount) {
      return res.status(400).json({ success: false, message: "amount is required" });
    }
    if (!holderSecret) {
      return res.status(400).json({ success: false, message: "holderSecret is required" });
    }

    const result = await tokenService.burnToken({ assetCode, amount, holderSecret,issuer });
    return res.status(200).json({
      message: 'Token burned successfully on Pi Network',
      txHash: result.hash,
    });
  } catch (error: any) {
    console.error('Error burning token:', error.response?.data?.extras?.result_codes);
    return res.status(500).json({ error: error.response?.data?.extras?.result_codes});
  }
};
