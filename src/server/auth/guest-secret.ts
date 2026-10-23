import crypto from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { dataPath } from "../data-dir";

let cachedSecret: { file: string; value: string } | null = null;
let pendingSecret: Promise<string> | null = null;

async function loadOrCreateSecret(file: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });

  try {
    const existing = (await readFile(file, "utf8")).trim();

    if (existing) {
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const created = crypto.randomBytes(32).toString("hex");
  // "wx" fails if the file already exists, so a secret that is already there is never overwritten.
  await writeFile(file, `${created}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return created;
}

/**
 * Secret that signs guest tokens: GUEST_SECRET if set, otherwise a random one
 * created on first use and kept in DATA_DIR/guest-secret (readable only by the owner).
 */
export async function getGuestSecret(): Promise<string> {
  const fromEnv = process.env.GUEST_SECRET?.trim();

  if (fromEnv) {
    return fromEnv;
  }

  const file = dataPath("guest-secret");

  if (cachedSecret?.file === file) {
    return cachedSecret.value;
  }

  // Concurrent first requests share one load, so only one of them creates the file.
  pendingSecret ??= loadOrCreateSecret(file).finally(() => {
    pendingSecret = null;
  });

  const value = await pendingSecret;
  cachedSecret = { file, value };
  return value;
}
