import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { passkeyService } from '../../services/passkey.service';
import { IUser } from '../../types';
import type { Types } from 'mongoose';

const getDeviceName = (req: Request): string => {
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('Windows')) return 'Windows Device';
  if (userAgent.includes('Mac')) return 'Mac Device';
  if (userAgent.includes('Linux')) return 'Linux Device';
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS Device';
  if (userAgent.includes('Android')) return 'Android Device';
  return 'Unknown Device';
};

export const startRegistration = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser as IUser;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const requestOrigin = req.headers.origin || req.headers.referer;
    const options = await passkeyService.generateRegistrationOptions(
      currentUser._id.toString(),
      currentUser.username,
      requestOrigin as string
    );

    const sessionId = passkeyService.getSessionId(currentUser._id.toString());
    
    return res.status(200).json({
      options,
      sessionId,
    });
  } catch (error: any) {
    logger.error('❌ startRegistration failed:', error);
    return res.status(500).json({ message: 'Failed to generate registration options', error: error.message });
  }
};

export const verifyRegistration = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser as IUser;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const { credential, sessionId } = req.body;
    if (!credential || !sessionId) {
      return res.status(400).json({ message: 'Missing credential or sessionId' });
    }

    const deviceName = getDeviceName(req);
    const requestOrigin = req.headers.origin || req.headers.referer;

    const result = await passkeyService.verifyRegistration(
      credential,
      sessionId,
      deviceName,
      requestOrigin as string
    );

    return res.status(200).json({
      success: true,
      verified: result.verified,
      credentialId: result.credentialId,
    });
  } catch (error: any) {
    logger.error('❌ verifyRegistration failed:', error);
    return res.status(500).json({ message: 'Failed to verify registration', error: error.message });
  }
};

export const startAuthentication = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser as IUser;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const requestOrigin = req.headers.origin || req.headers.referer;
    const { options, sessionId } = await passkeyService.generateAuthenticationOptions(
      currentUser._id.toString(),
      requestOrigin as string
    );

    return res.status(200).json({
      options,
      sessionId,
    });
  } catch (error: any) {
    logger.error('❌ startAuthentication failed:', error);
    return res.status(500).json({ message: 'Failed to generate authentication options', error: error.message });
  }
};

export const verifyAuthentication = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser as IUser;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const { credential, sessionId } = req.body;
    if (!credential || !sessionId) {
      return res.status(400).json({ message: 'Missing credential or sessionId' });
    }

    const requestOrigin = req.headers.origin || req.headers.referer;
    const result = await passkeyService.verifyAuthentication(
      credential,
      sessionId,
      requestOrigin as string
    );

    if (!result.verified) {
      return res.status(401).json({ message: 'Authentication verification failed' });
    }

    return res.status(200).json({
      success: true,
      verified: true,
      credentialId: result.credentialId,
      sessionToken: sessionId, // In production, generate a proper JWT session token
    });
  } catch (error: any) {
    logger.error('❌ verifyAuthentication failed:', error);
    return res.status(500).json({ message: 'Failed to verify authentication', error: error.message });
  }
};

export const listPasskeys = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser as IUser;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const passkeys = await passkeyService.getUserPasskeys(currentUser._id);

    return res.status(200).json({
      success: true,
      passkeys: passkeys.map((p) => ({
        credentialId: p.credentialId,
        deviceName: p.deviceName,
        lastUsedAt: p.lastUsedAt,
        createdAt: p.createdAt,
        isActive: p.isActive,
      })),
    });
  } catch (error: any) {
    logger.error('❌ listPasskeys failed:', error);
    return res.status(500).json({ message: 'Failed to list passkeys', error: error.message });
  }
};

export const deletePasskey = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser as IUser;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const { credentialId } = req.params;
    if (!credentialId) {
      return res.status(400).json({ message: 'Missing credentialId' });
    }

    await passkeyService.deletePasskey(credentialId, currentUser._id);

    return res.status(200).json({
      success: true,
      message: 'Passkey deleted successfully',
    });
  } catch (error: any) {
    logger.error('❌ deletePasskey failed:', error);
    return res.status(500).json({ message: 'Failed to delete passkey', error: error.message });
  }
};

