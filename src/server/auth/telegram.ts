import crypto from "crypto";

export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_bot?: boolean;
};

export type VerifiedTelegramAuth = {
  user: TelegramWebAppUser;
  authDate: number;
};

export type VerifyOptions = {
  /** Reject initData older than this many seconds. 0 or undefined turns the check off. */
  maxAgeSeconds?: number;
  /** Current time in milliseconds. Only for tests. */
  now?: number;
};

function hmacSha256Hex(key: crypto.BinaryLike, data: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

function createSecretKey(botToken: string): Buffer {
  return crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** "key=value" lines sorted by key, without the hash field (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
export function buildDataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? compareText(leftValue, rightValue) : compareText(leftKey, rightKey)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: VerifyOptions = {}
): VerifiedTelegramAuth {
  if (!initData) {
    throw new Error("Telegram initData is missing.");
  }

  if (!botToken) {
    throw new Error("Telegram bot token is missing.");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram initData hash is missing.");
  }

  const dataCheckString = buildDataCheckString(params);
  const secretKey = createSecretKey(botToken);
  const expectedHash = hmacSha256Hex(secretKey, dataCheckString);

  const receivedBuffer = Buffer.from(receivedHash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    throw new Error("Telegram initData verification failed.");
  }

  const userRaw = params.get("user");
  const authDateRaw = params.get("auth_date");

  if (!userRaw || !authDateRaw) {
    throw new Error("Telegram initData is missing user data.");
  }

  let user: TelegramWebAppUser;

  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    throw new Error("Telegram user payload is invalid.");
  }

  if (typeof user?.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new Error("Telegram user payload is invalid.");
  }

  const authDate = Number.parseInt(authDateRaw, 10);

  if (!Number.isFinite(authDate)) {
    throw new Error("Telegram auth date is invalid.");
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? 0;

  if (maxAgeSeconds > 0) {
    const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

    if (nowSeconds - authDate > maxAgeSeconds) {
      throw new Error("Telegram initData has expired.");
    }
  }

  return {
    user,
    authDate
  };
}

export function buildTelegramDisplayName(user: TelegramWebAppUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
}
