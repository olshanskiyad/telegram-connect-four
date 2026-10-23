/** Runtime settings read from environment variables (see .env.example). */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function getBotToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

export function getBotUsername(): string {
  return (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
}

/**
 * Guest mode lets a visitor without Telegram play in the browser.
 * GUEST_MODE=true|false decides explicitly; when it is not set, guests are allowed
 * only while no bot token is configured (a plain local run).
 */
export function isGuestModeEnabled(): boolean {
  const raw = (process.env.GUEST_MODE ?? "").trim().toLowerCase();

  if (TRUE_VALUES.has(raw)) {
    return true;
  }

  if (FALSE_VALUES.has(raw)) {
    return false;
  }

  return getBotToken() === "";
}

/** Maximum age of Telegram initData in seconds. 0 turns the check off. */
export function getTelegramAuthMaxAgeSeconds(): number {
  const raw = process.env.TELEGRAM_AUTH_MAX_AGE;

  if (raw === undefined || raw.trim() === "") {
    return 86400;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 86400;
}

/** Address of the WebSocket server as the browser sees it. Empty means the same host, path /ws. */
export function getWsPublicUrl(): string {
  return (process.env.WS_PUBLIC_URL ?? "").trim();
}
