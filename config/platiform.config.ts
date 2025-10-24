import axios from "axios";
import env from "./env";

export const platformAPIClient = axios.create({
  baseURL: env.PLATFORM_API_URL,
  timeout: 120000,
  headers: {
    Authorization: `Key ${env.PI_API_KEY}`,
    "Content-Type": "application/json"
  },
});

