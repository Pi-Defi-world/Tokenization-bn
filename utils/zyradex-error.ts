/**
 * Zyradex error system: one pattern, user-friendly messages, no code/technical jargon in responses.
 * All API errors return the same shape: { success: false, message: string }.
 * No emojis in messages sent to the frontend.
 */

export const ZYRADEX_BRAND = 'Zyradex';

/** Remove emojis and other symbols from text sent to the frontend. */
function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Misc Symbols and Pictographs, Emoticons, etc.
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols (e.g. ✅ ❌)
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .replace(/\s+/g, ' ')
    .trim();
}

/** Standard API error body – same shape everywhere */
export interface ZyradexErrorBody {
  success: false;
  message: string;
}

/** Generic fallback when we must not expose internal details */
export const GENERIC_MESSAGE = `${ZYRADEX_BRAND}: Something went wrong. Please try again.`;

/** Patterns that indicate a message is safe to show to users (no stack, no internal codes) */
const FRIENDLY_PATTERNS = [
  /please try again/i,
  /add more .+ to your account/i,
  /reduce the amount/i,
  /your (balance|account)/i,
  /you (don't|do not) have/i,
  /insufficient/i,
  /required/i,
  /sign in/i,
  /not found/i,
  /missing/i,
  /invalid/i,
  /check your/i,
  /we couldn't/i,
  /something went wrong/i,
];

/** Messages we never send to the client (internal/config) */
const NEVER_EXPOSE = [
  /secret|password|key|env|process\.env/i,
  /undefined|null|\[object/i,
  /at \s+\w+ \(.*\.(ts|js):/i, // stack traces
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i,
  /status(Code)?\s*[=:]\s*\d+/i,
];

function isFriendly(msg: string): boolean {
  if (!msg || msg.length > 500) return false;
  if (NEVER_EXPOSE.some((re) => re.test(msg))) return false;
  return FRIENDLY_PATTERNS.some((re) => re.test(msg)) || msg.length < 120;
}

/**
 * Turn any thrown value into a single user-facing message.
 * Use this everywhere before sending errors to the client.
 */
export function toUserMessage(err: unknown): string {
  if (err == null) return GENERIC_MESSAGE;
  const msg =
    typeof (err as Error).message === 'string'
      ? (err as Error).message
      : String(err);
  const trimmed = msg.trim();
  const out = isFriendly(trimmed) ? trimmed : GENERIC_MESSAGE;
  return stripEmoji(out);
}

/**
 * Build the standard error response body. Controllers and middleware use this.
 */
export function errorBody(message: string): ZyradexErrorBody {
  const clean = stripEmoji(message.trim()) || GENERIC_MESSAGE;
  return {
    success: false,
    message: clean,
  };
}

/**
 * Build error body from an unknown error (sanitized).
 */
export function errorBodyFrom(err: unknown): ZyradexErrorBody {
  return errorBody(toUserMessage(err));
}
