import { validateNickname } from "@/lib/profile";

import { isGuestToken, signGuestToken, verifyGuestToken } from "../auth/guest";
import { getGuestSecret } from "../auth/guest-secret";
import { verifyTelegramInitData } from "../auth/telegram";
import { getBotToken, getTelegramAuthMaxAgeSeconds, isGuestModeEnabled } from "../config";
import {
  createGuestProfile,
  touchProfile,
  updateNickname,
  upsertTelegramProfile,
  type StoredProfile
} from "./store";

function ensureBotToken(): string {
  const botToken = getBotToken();

  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  return botToken;
}

/** Telegram only: checks initData against the bot token and saves the profile. */
export async function authenticateTelegramUser(initData: string): Promise<StoredProfile> {
  const verified = verifyTelegramInitData(initData, ensureBotToken(), {
    maxAgeSeconds: getTelegramAuthMaxAgeSeconds()
  });
  return upsertTelegramProfile(verified.user);
}

/**
 * Turns the credential sent by the client into a profile.
 * The credential is either Telegram initData (checked against the bot token) or a guest token
 * (only when guest mode is on). The request field is still called initData for both.
 */
export async function authenticateUser(credential: string): Promise<StoredProfile> {
  if (isGuestToken(credential)) {
    if (!isGuestModeEnabled()) {
      throw new Error("Guest mode is disabled.");
    }

    const guestId = verifyGuestToken(credential, await getGuestSecret());
    const profile = await touchProfile(guestId);

    if (!profile) {
      throw new Error("Guest profile not found.");
    }

    return profile;
  }

  return authenticateTelegramUser(credential);
}

export type GuestSession = {
  profile: StoredProfile;
  token: string;
};

/** Returns the guest for a valid saved token, otherwise creates a new guest. */
export async function openGuestSession(savedToken?: string): Promise<GuestSession> {
  if (!isGuestModeEnabled()) {
    throw new Error("Guest mode is disabled.");
  }

  const secret = await getGuestSecret();

  if (savedToken && isGuestToken(savedToken)) {
    try {
      const existing = await touchProfile(verifyGuestToken(savedToken, secret));

      if (existing) {
        return { profile: existing, token: savedToken };
      }
    } catch {
      // Unknown or edited token: fall through and create a new guest.
    }
  }

  const profile = await createGuestProfile();
  return { profile, token: signGuestToken(profile.telegramId, secret) };
}

export async function changeNickname(credential: string, nickname: string): Promise<StoredProfile> {
  const profile = await authenticateUser(credential);
  const normalized = validateNickname(nickname);

  if (!normalized.valid) {
    throw new Error(normalized.message ?? "Nickname is invalid.");
  }

  return updateNickname(profile.telegramId, normalized.nickname);
}
