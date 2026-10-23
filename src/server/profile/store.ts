import crypto from "crypto";
import { readFile } from "fs/promises";

import { normalizeNickname } from "@/lib/profile";

import { buildTelegramDisplayName, type TelegramWebAppUser } from "../auth/telegram";
import { dataPath } from "../data-dir";
import { parseJsonFile, writeJsonFile } from "../json-file";

/**
 * telegramId is the player's id everywhere in the game: positive for Telegram users,
 * negative for guests (see auth/guest.ts). telegramName, telegramUsername and telegramPhotoUrl
 * are copied from Telegram and are personal data; guests have a generated name and no username or photo.
 * The nickname is what other players see. It starts as a neutral "Игрок 1234" and the player can change it.
 */
export type StoredProfile = {
  telegramId: number;
  telegramName: string;
  telegramUsername: string | null;
  telegramPhotoUrl: string | null;
  nickname: string;
  createdAt: string;
  updatedAt: string;
};

type ProfileRecord = {
  profiles: StoredProfile[];
};

const STORE_FILE = "profiles.json";
let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<ProfileRecord> {
  try {
    const raw = await readFile(dataPath(STORE_FILE), "utf8");
    const parsed = parseJsonFile(raw, STORE_FILE) as Partial<ProfileRecord>;

    if (!parsed.profiles || !Array.isArray(parsed.profiles)) {
      return { profiles: [] };
    }

    return { profiles: parsed.profiles };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { profiles: [] };
    }

    throw error;
  }
}

async function writeStore(store: ProfileRecord): Promise<void> {
  await writeJsonFile(dataPath(STORE_FILE), store);
}

async function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = writeQueue;
  let release!: () => void;

  writeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await task();
  } finally {
    release();
  }
}

/** Neutral default nickname such as "Игрок 1234" (10 characters, the nickname limit). The Telegram name is not used. */
function defaultNickname(prefix: string): string {
  return `${prefix} ${crypto.randomInt(1000, 10000)}`;
}

function normalizeTelegramProfile(user: TelegramWebAppUser): StoredProfile {
  const now = new Date().toISOString();

  return {
    telegramId: user.id,
    telegramName: buildTelegramDisplayName(user) || "Пользователь",
    telegramUsername: user.username ?? null,
    telegramPhotoUrl: user.photo_url ?? null,
    nickname: defaultNickname("Игрок"),
    createdAt: now,
    updatedAt: now
  };
}

export async function upsertTelegramProfile(user: TelegramWebAppUser): Promise<StoredProfile> {
  return withWriteLock(async () => {
    const store = await readStore();
    const existingIndex = store.profiles.findIndex((profile) => profile.telegramId === user.id);
    const existing = existingIndex >= 0 ? store.profiles[existingIndex] : null;

    const nextProfile: StoredProfile = existing
      ? {
          ...existing,
          telegramName: buildTelegramDisplayName(user) || existing.telegramName,
          telegramUsername: user.username ?? existing.telegramUsername,
          telegramPhotoUrl: user.photo_url ?? existing.telegramPhotoUrl,
          updatedAt: new Date().toISOString()
        }
      : normalizeTelegramProfile(user);

    if (existingIndex >= 0) {
      store.profiles[existingIndex] = nextProfile;
    } else {
      store.profiles.push(nextProfile);
    }

    await writeStore(store);
    return nextProfile;
  });
}

/** New guest profile with the next free negative id (-1, -2, ...) and a random nickname like "Гость 1234". */
export async function createGuestProfile(): Promise<StoredProfile> {
  return withWriteLock(async () => {
    const store = await readStore();
    const lowestId = store.profiles.reduce((lowest, profile) => Math.min(lowest, profile.telegramId), 0);
    const nickname = defaultNickname("Гость");
    const now = new Date().toISOString();

    const profile: StoredProfile = {
      telegramId: lowestId - 1,
      telegramName: nickname,
      telegramUsername: null,
      telegramPhotoUrl: null,
      nickname,
      createdAt: now,
      updatedAt: now
    };

    store.profiles.push(profile);
    await writeStore(store);
    return profile;
  });
}

/** Marks a profile as seen now (used for the online counter). Returns null if there is no such profile. */
export async function touchProfile(telegramId: number): Promise<StoredProfile | null> {
  return withWriteLock(async () => {
    const store = await readStore();
    const index = store.profiles.findIndex((profile) => profile.telegramId === telegramId);

    if (index === -1) {
      return null;
    }

    const nextProfile: StoredProfile = {
      ...store.profiles[index],
      updatedAt: new Date().toISOString()
    };

    store.profiles[index] = nextProfile;
    await writeStore(store);
    return nextProfile;
  });
}

export async function updateNickname(
  telegramId: number,
  nickname: string
): Promise<StoredProfile> {
  return withWriteLock(async () => {
    const store = await readStore();
    const index = store.profiles.findIndex((profile) => profile.telegramId === telegramId);

    if (index === -1) {
      throw new Error("Profile not found.");
    }

    const nextProfile: StoredProfile = {
      ...store.profiles[index],
      nickname: normalizeNickname(nickname),
      updatedAt: new Date().toISOString()
    };

    store.profiles[index] = nextProfile;
    await writeStore(store);

    return nextProfile;
  });
}

export async function listProfiles(): Promise<StoredProfile[]> {
  const store = await readStore();
  return [...store.profiles].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function countRecentlySeenProfiles(maxAgeMs = 3 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const store = await readStore();

  return store.profiles.filter((profile) => {
    const updatedAt = Date.parse(profile.updatedAt);
    return Number.isFinite(updatedAt) && updatedAt >= cutoff;
  }).length;
}
