import { Request, Response, NextFunction } from "express";

type FieldType = "string" | "number" | "boolean";

interface FieldSpec {
  name: string;
  type: FieldType;
}

export const validateFields =
  (fields: FieldSpec[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    for (const field of fields) {
      const value = req.body[field.name];
      if (value === undefined || value === null) {
        res.status(400).json({
          status: "error",
          message: `Missing required field: ${field.name}`,
        });
        return;
      }
      if (field.type === "string" && typeof value !== "string") {
        res.status(400).json({
          status: "error",
          message: `Invalid type for field ${field.name}: expected string`,
        });
        return;
      }
      if (field.type === "number" && typeof value !== "number") {
        res.status(400).json({
          status: "error",
          message: `Invalid type for field ${field.name}: expected number`,
        });
        return;
      }
      if (field.type === "boolean" && typeof value !== "boolean") {
        res.status(400).json({
          status: "error",
          message: `Invalid type for field ${field.name}: expected boolean`,
        });
        return;
      }
    }
    next();
  };