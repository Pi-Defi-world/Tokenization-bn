import { platformAPIClient } from "../config/platiform.config";
import env from "../config/env";
import User from "../models/User";
import { IAuthResult, IUser } from "../types";
import { logger } from "../utils/logger";
import { AccountService } from "./account.service";
import { jwtService } from "./jwt.service";

interface IAuthResponse {
  user: IUser;
  token: string;
}

class UsersService {
  private accountService: AccountService;

  constructor() {
    this.accountService = new AccountService();
  }

  async signInUser(authResult: IAuthResult): Promise<IAuthResponse> {
    // Always validate access token with Pi API and get user data from API response
    let piApiUser: any;
    
    try {
      if (!authResult.accessToken || authResult.accessToken.trim() === '') {
        logger.error('Empty or missing access token provided');
        throw new Error("Invalid access token: token is empty");
      }

      // Validate token and get user data from Pi API
      const response = await platformAPIClient.get("/v2/me", {
        headers: { Authorization: `Bearer ${authResult.accessToken}` },
      });

      // Use user data from Pi API response, not from frontend
      piApiUser = response.data;
      
      if (!piApiUser || !piApiUser.username) {
        logger.error('Pi API response missing user data');
        throw new Error("Invalid response from Pi API: missing user data");
      }

      logger.info(`✅ Pi API authentication successful for user: ${piApiUser.username}`);

    } catch (error: any) {
      // Log more details about the error for debugging
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
      const statusCode = error?.response?.status || error?.status;
      const isTimeout = error?.code === 'ECONNABORTED' || errorMessage?.includes('timeout');
      
      logger.error(`Pi API authentication failed: ${errorMessage} (Status: ${statusCode})`);
      logger.error(`Access token (first 20 chars): ${authResult.accessToken?.substring(0, 20)}...`);
      
      if (isTimeout) {
        logger.error('Pi API request timed out. Possible causes:');
        logger.error('1. Pi Network API server is unreachable or slow');
        logger.error('2. Network connectivity issues');
        logger.error('3. PLATFORM_API_URL may be incorrect');
        logger.error(`   Current URL: ${env.PLATFORM_API_URL || 'not set'}`);
        throw new Error("Pi Network API request timed out. Please check your network connection and try again.");
      }
      
      // Provide more specific error message
      if (statusCode === 401 || statusCode === 403) {
        throw new Error("Invalid or expired access token. Please re-authenticate with Pi Network.");
      } else if (statusCode === 500) {
        throw new Error("Pi Network API error. Please try again later.");
      } else {
        throw new Error(`Authentication failed: ${errorMessage}`);
      }
    }

    try {
      // Use validated user data from Pi API, with fallback to frontend data
      const validatedUsername = piApiUser.username || authResult.user.username;
      const validatedUid = piApiUser.uid || authResult.user.uid;

      if (!validatedUsername) {
        throw new Error("Unable to determine username from Pi API response");
      }

      // Always validate user exists or create new one
      let user = await User.findOne({ username: validatedUsername });
      if (!user) {
        // User doesn't exist, create new user with validated data
        user = new User({
          uid: validatedUid,
          username: validatedUsername,
          // public_key is optional and will be undefined by default
          tokens: [],
          liquidityPools: [],
          role: "user",
          verified: false,
        });
        await user.save();
        logger.info(`New user created: ${validatedUsername}`);
      } else {
        // User exists, always update uid from validated Pi API data
        if (validatedUid && user.uid !== validatedUid) {
          user.uid = validatedUid;
          await user.save();
          logger.info(`User uid updated: ${validatedUsername}`);
        }
      }

      const plainUser = await User.findById(user._id);

      if (!plainUser) {
        throw new Error("User not found after creation");
      }

      const token = jwtService.generateToken({
        id: plainUser.id,
        username: plainUser.username,
      });

      // Refresh balance in background if user has a public key
      // This ensures fresh balance on login without blocking the response
      if (plainUser.public_key && plainUser.public_key.trim() !== '') {
        this.accountService.refreshBalancesInBackground(plainUser.public_key).catch((error) => {
          logger.warn(`Background balance refresh on login failed for ${plainUser.public_key}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }

      return {
        user: plainUser,
        token,
      };
    } catch (error) {
      logger.error('Error in signInUser:', error);
      throw error;
    }
  }

  async removePublicKey(userId: string): Promise<void> {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Remove public_key from user (set to undefined to work with sparse unique index)
      user.public_key = undefined;
      await user.save();
      logger.info(`Public key removed for user ${userId}`);
    } catch (error) {
      logger.error('Error removing public key:', error);
      throw error;
    }
  }

  async setPublicKey(userId: string, publicKey: string): Promise<IUser> {
    const user = await User.findByIdAndUpdate(
      userId,
      { public_key: publicKey },
      { new: true }
    );
    if (!user) throw new Error('User not found');
    return user;
  }
}

export const usersService = new UsersService();
