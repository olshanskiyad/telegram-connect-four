import crypto from "crypto";

/**
 * Guest sessions for playing in a browser without Telegram.
 *
 * A guest has a negative numeric id (Telegram ids are always positive, so the two never collide)
 * and a token "guest.<id>.<hmac>". The server signs the id with a secret, so a token cannot be made up
 * or edited, only received from POST /api/auth/guest. API calls send the token in place of Telegram initData.
 */

const TOKEN_PREFIX = "guest.";

function sign(id: number, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`guest:${id}`).digest("hex");
}

export function isGuestToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

export function signGuestToken(id: number, secret: string): string {
  if (!Number.isSafeInteger(id) || id >= 0) {
    throw new Error("Guest id must be a negative integer.");
  }

  return `${TOKEN_PREFIX}${id}.${sign(id, secret)}`;
}

/** Returns the guest id, or throws if the token is malformed or was not signed with this secret. */
export function verifyGuestToken(token: string, secret: string): number {
  const match = /^guest\.(-[1-9]\d*)\.([0-9a-f]{64})$/.exec(token);

  if (!match) {
    throw new Error("Guest token is invalid.");
  }

  const id = Number(match[1]);

  if (!Number.isSafeInteger(id)) {
    throw new Error("Guest token is invalid.");
  }

  const received = Buffer.from(match[2], "hex");
  const expected = Buffer.from(sign(id, secret), "hex");

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new Error("Guest token is invalid.");
  }

  return id;
}
