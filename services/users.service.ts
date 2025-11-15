import { platformAPIClient } from "../config/platiform.config";
import User from "../models/User";
import { IAuthResult, IUser } from "../types";
import { logger } from "../utils/logger";
import { jwtService } from "./jwt.service";

interface IAuthResponse {
  user: IUser;
  token: string;
}

class UsersService {
  async signInUser(authResult: IAuthResult): Promise<IAuthResponse> {
    try {
     const dd=  await platformAPIClient.get("/v2/me", {
        headers: { Authorization: `Bearer ${authResult.accessToken}` },
      });

      console.log(dd)

    } catch (error) {
      throw new Error("Invalid access token");
    }

    try {
      let user = await User.findOne({ username: authResult.user.username });
      if (!user) {
        // User doesn't exist, create new user
        user = new User({
          uid: authResult.user.uid,
          username: authResult.user.username,
          public_key: "",
          tokens: [],
          liquidityPools: [],
          role: "user",
          verified: false,
        });
        await user.save();
        logger.info(`New user created: ${authResult.user.username}`);
      } else {
        // User exists, update uid if it changed
        if (user.uid !== authResult.user.uid) {
          user.uid = authResult.user.uid;
          await user.save();
          logger.info(`User uid updated: ${authResult.user.username}`);
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

      // Remove public_key from user
      user.public_key = "";
      await user.save();
      logger.info(`Public key removed for user ${userId}`);
    } catch (error) {
      logger.error('Error removing public key:', error);
      throw error;
    }
  }
}

export const usersService = new UsersService();
