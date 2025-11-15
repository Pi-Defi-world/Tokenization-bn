
import { Request, Response } from 'express';
import { feeService } from '../../services/fee.service';


export const createFee = async (req: Request, res: Response) => {
  try {
    const { key, description, value, currency, isActive } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const fee = await feeService.createFee({
      key,
      description,
      value,
      currency: currency || 'PI',
      isActive: isActive ?? true,
    });

    res.status(201).json({ success: true, fee });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getFees = async (_req: Request, res: Response) => {
  const fees = await feeService.getFees();
  res.json({ success: true, fees });
};

export const updateFee = async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const updates = req.body;

    const updated = await feeService.updateFee(key, updates);
    res.json({ success: true, fee: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};
