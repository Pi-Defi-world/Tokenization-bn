import jwt from "jsonwebtoken";
import env from "../config/env";

interface ITokenPayload {
  id: string;
  username: string;
}

class JwtService {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  generateToken(payload: ITokenPayload): string {
    return jwt.sign(payload, this.secret, { expiresIn: "30d" });
  }

  decodeToken(token: string): ITokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret) as ITokenPayload;
      return decoded;
    } catch (error: any) {
      console.error("Invalid token:", error.message);
      return null;
    }
  }
}

export const jwtService = new JwtService(env.JWT_SECRET);

