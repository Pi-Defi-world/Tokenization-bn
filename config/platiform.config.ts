import axios from "axios";
import env from "./env";

export const platformAPIClient = axios.create({
  baseURL: env.PLATFORM_API_URL,
  timeout: 30000, // Reduced to 30 seconds (was 120s)
  headers: {
    Authorization: `Key ${env.PI_API_KEY}`,
    "Content-Type": "application/json"
  },
});

