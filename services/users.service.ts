
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
      await platformAPIClient.get("/v2/me", {
        headers: { Authorization: `Bearer ${authResult.accessToken}` },
      });

    } catch (error) {
      throw new Error("Invalid access token");
    }

    try {
      let user = await User.findOne({ username: authResult.user.username });
      if (!user) {
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
      }

      const plainUser = await User.findById(user._id);

      const token = jwtService.generateToken({
        id: plainUser!.id,
        username: plainUser!.username,
      });

      return {
        user: plainUser!,
        token,
      };
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
}

export const usersService = new UsersService();
