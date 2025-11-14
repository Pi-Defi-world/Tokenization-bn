import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type GenerateAuthenticationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type VerifyAuthenticationResponseOpts,
} from '@simplewebauthn/server';
import type { PublicKeyCredentialRequestOptionsJSON, PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { logger } from '../utils/logger';
import env from '../config/env';
import Passkey from '../models/Passkey';
import type { Types, ObjectId } from 'mongoose';

interface ChallengeStore {
  challenge: string;
  userId: string;
  expiresAt: number;
}

const challenges = new Map<string, ChallengeStore>();

const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function getRPID(requestOrigin?: string): string {
  if (env.WEBAUTHN_RP_ID && env.WEBAUTHN_RP_ID !== '') {
    return env.WEBAUTHN_RP_ID;
  }
  if (requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      return url.hostname;
    } catch {
      return '';
    }
  }
  return '';
}

function getOrigin(requestOrigin?: string): string {
  if (env.WEBAUTHN_ORIGIN) {
    return env.WEBAUTHN_ORIGIN;
  }
  if (requestOrigin) {
    try {
      // Extract just the origin (protocol + hostname + port) from the URL
      const url = new URL(requestOrigin);
      return url.origin;
    } catch {
      // If parsing fails, return as-is (fallback)
      return requestOrigin;
    }
  }
  return 'https://tokenization-bn.vercel.app';
}

export class PasskeyService {
  async generateRegistrationOptions(
    userId: string,
    username: string,
    requestOrigin?: string
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    try {
      const rpID = getRPID(requestOrigin);
      const origin = getOrigin(requestOrigin);
      const rpName = env.WEBAUTHN_RP_NAME;

      const existingPasskeys = await Passkey.find({ userId, isActive: true });

      const opts: GenerateRegistrationOptionsOpts = {
        rpName,
        rpID,
        userID: Buffer.from(userId),
        userName: username,
        timeout: 60000,
        attestationType: 'none',
        excludeCredentials: existingPasskeys.map((passkey) => ({
          id: passkey.credentialId,
          type: 'public-key' as const,
        })),
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
          authenticatorAttachment: 'platform',
        },
        supportedAlgorithmIDs: [-7, -257],
      };

      const options = await generateRegistrationOptions(opts);

      const challenge = options.challenge;
      const sessionId = `${userId}-${Date.now()}`;

      challenges.set(sessionId, {
        challenge,
        userId,
        expiresAt: Date.now() + CHALLENGE_EXPIRY_MS,
      });

      logger.info(`Generated registration options for user ${userId}`);

      return {
        ...options,
        challenge,
      };
    } catch (error: any) {
      logger.error('Error generating registration options:', error);
      throw error;
    }
  }

  async verifyRegistration(
    credentialResponse: any,
    sessionId: string,
    deviceName: string,
    requestOrigin?: string
  ): Promise<{ verified: boolean; credentialId: string }> {
    try {
      const storedChallenge = challenges.get(sessionId);
      if (!storedChallenge) {
        throw new Error('Challenge not found or expired');
      }

      if (Date.now() > storedChallenge.expiresAt) {
        challenges.delete(sessionId);
        throw new Error('Challenge expired');
      }

      const rpID = getRPID(requestOrigin);
      const origin = getOrigin(requestOrigin);

      const opts: VerifyRegistrationResponseOpts = {
        response: credentialResponse,
        expectedChallenge: storedChallenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      };

      const verification = await verifyRegistrationResponse(opts);

      if (!verification.verified || !verification.registrationInfo) {
        throw new Error('Registration verification failed');
      }

      const registrationInfo = verification.registrationInfo;
      if (!registrationInfo) {
        throw new Error('Registration info not available');
      }

      const credential = registrationInfo.credential;
      const credentialID = credential.id; // Already a Base64URLString
      const credentialPublicKey = credential.publicKey; // Uint8Array
      // New credentials start with counter 0
      const counter = 0;

      const credentialIdBase64 = credentialID; // Already base64url string
      const publicKeyBase64 = Buffer.from(credentialPublicKey).toString('base64');

      await Passkey.create({
        credentialId: credentialIdBase64,
        publicKey: publicKeyBase64,
        counter,
        deviceName,
        userId: storedChallenge.userId,
        lastUsedAt: new Date(),
        isActive: true,
      });

      challenges.delete(sessionId);

      logger.success(`Passkey registered for user ${storedChallenge.userId}`);

      return {
        verified: true,
        credentialId: credentialIdBase64,
      };
    } catch (error: any) {
      logger.error('Error verifying registration:', error);
      throw error;
    }
  }

  async generateAuthenticationOptions(
    userId: string,
    requestOrigin?: string
  ): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; sessionId: string }> {
    try {
      const passkeys = await Passkey.find({ userId, isActive: true });
      if (passkeys.length === 0) {
        throw new Error('No passkeys found for user');
      }

      const rpID = getRPID(requestOrigin);
      const origin = getOrigin(requestOrigin);

      const opts: GenerateAuthenticationOptionsOpts = {
        rpID,
        timeout: 60000,
        allowCredentials: passkeys.map((passkey) => ({
          id: passkey.credentialId,
          type: 'public-key' as const,
          transports: ['internal'] as ('internal')[],
        })),
        userVerification: 'required',
      };

      const options = await generateAuthenticationOptions(opts);

      const challenge = options.challenge;
      const sessionId = `${userId}-${Date.now()}`;

      challenges.set(sessionId, {
        challenge,
        userId,
        expiresAt: Date.now() + CHALLENGE_EXPIRY_MS,
      });

      logger.info(`Generated authentication options for user ${userId}`);

      return {
        options: {
          ...options,
          challenge,
        },
        sessionId,
      };
    } catch (error: any) {
      logger.error('Error generating authentication options:', error);
      throw error;
    }
  }

  async verifyAuthentication(
    credentialResponse: any,
    sessionId: string,
    requestOrigin?: string
  ): Promise<{ verified: boolean; credentialId: string }> {
    try {
      const storedChallenge = challenges.get(sessionId);
      if (!storedChallenge) {
        throw new Error('Challenge not found or expired');
      }

      if (Date.now() > storedChallenge.expiresAt) {
        challenges.delete(sessionId);
        throw new Error('Challenge expired');
      }

      // credentialResponse.id is already base64url encoded from the frontend
      const credentialIdBase64 = typeof credentialResponse.id === 'string' 
        ? credentialResponse.id 
        : Buffer.from(credentialResponse.id).toString('base64url');
      
      const passkey = await Passkey.findOne({
        credentialId: credentialIdBase64,
        userId: storedChallenge.userId,
        isActive: true,
      });

      if (!passkey) {
        throw new Error('Passkey not found');
      }

      const rpID = getRPID(requestOrigin);
      const origin = getOrigin(requestOrigin);

      const opts: VerifyAuthenticationResponseOpts = {
        response: credentialResponse,
        expectedChallenge: storedChallenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
          counter: passkey.counter,
        },
        requireUserVerification: true,
      };

      const verification = await verifyAuthenticationResponse(opts);

      if (!verification.verified) {
        throw new Error('Authentication verification failed');
      }

      const { newCounter } = verification.authenticationInfo;

      await Passkey.findByIdAndUpdate(passkey._id, {
        counter: newCounter,
        lastUsedAt: new Date(),
      });

      challenges.delete(sessionId);

      logger.success(`Passkey authenticated for user ${storedChallenge.userId}`);

      return {
        verified: true,
        credentialId: passkey.credentialId,
      };
    } catch (error: any) {
      logger.error('Error verifying authentication:', error);
      throw error;
    }
  }

  async getUserPasskeys(userId: string | Types.ObjectId | ObjectId) {
    return Passkey.find({ userId, isActive: true }).sort({ createdAt: -1 });
  }

  async deletePasskey(credentialId: string, userId: string | Types.ObjectId | ObjectId): Promise<void> {
    const passkeys = await Passkey.find({ userId, isActive: true });
    if (passkeys.length <= 1) {
      throw new Error('Cannot delete the last passkey');
    }

    const passkey = await Passkey.findOne({ credentialId, userId, isActive: true });
    if (!passkey) {
      throw new Error('Passkey not found');
    }

    await Passkey.findByIdAndUpdate(passkey._id, { isActive: false });
    logger.info(`Passkey ${credentialId} deleted for user ${userId}`);
  }

  getSessionId(userId: string): string {
    return `${userId}-${Date.now()}`;
  }
}

export const passkeyService = new PasskeyService();

