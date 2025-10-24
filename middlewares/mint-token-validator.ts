import { Request, Response, NextFunction } from "express";

export function validateMintTokenFields(req: Request, res: Response, next: NextFunction) {
  const requiredFields = [
    "name",
    "assetCode",
    "distributorSecret",
    "description",
    "totalSupply"
  ];

  for (const field of requiredFields) {
    if (
      req.body[field] === undefined ||
      req.body[field] === null ||
      (typeof req.body[field] === "string" && req.body[field].trim() === "")
    ) {
      return res.status(400).json({
        status: "error",
        message: `Missing required field: ${field}`
      });
    }
  }

  if (typeof req.body["totalSupply"] !== "number") {
    return res.status(400).json({
      status: "error",
      message: "Invalid type for field totalSupply: expected number"
    });
  }

  next();
}
