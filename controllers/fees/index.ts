
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
      currency: currency || 'ZYRA',
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

    const feeKey: string = Array.isArray(key) ? key[0] : (key ?? '');
    if (!feeKey) {
      return res.status(400).json({ success: false, message: 'Fee key is required' });
    }

    const updated = await feeService.updateFee(feeKey, updates);
    res.json({ success: true, fee: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};
