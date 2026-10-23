import crypto from "node:crypto";

/** Signs fields the way Telegram does: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  return new URLSearchParams({ ...fields, hash }).toString();
}
