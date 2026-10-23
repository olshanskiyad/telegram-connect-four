"use client";

import { useEffect, useState } from "react";

import { postJson } from "./api";
import { getPublicConfig } from "./config";
import { bootstrapTelegramWebApp, getTelegramInitData } from "./telegram-webapp";

export type SessionProfile = {
  telegramId: number;
  telegramName: string;
  telegramUsername: string | null;
  telegramPhotoUrl: string | null;
  nickname: string;
};

export type SessionState = {
  /** loading: signing in; ready: signed in; unavailable: cannot sign in (see error). */
  status: "loading" | "ready" | "unavailable";
  /** Value for the "initData" field of API calls: Telegram initData or a guest token. Empty until ready. */
  initData: string;
  profile: SessionProfile | null;
  /** True when playing as a guest in a browser, false inside Telegram. */
  guest: boolean;
  error: string;
};

export type Session = SessionState & {
  setProfile: (profile: SessionProfile) => void;
};

const GUEST_TOKEN_KEY = "connect-four.guestToken";
const OPEN_IN_TELEGRAM = "Откройте игру из Telegram.";

const LOADING: SessionState = { status: "loading", initData: "", profile: null, guest: false, error: "" };

function readGuestToken(): string {
  try {
    return window.localStorage.getItem(GUEST_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveGuestToken(token: string): void {
  try {
    window.localStorage.setItem(GUEST_TOKEN_KEY, token);
  } catch {
    // Private mode or blocked storage: the guest lasts until the page is closed.
  }
}

async function signIn(): Promise<SessionState> {
  bootstrapTelegramWebApp();
  const telegramInitData = getTelegramInitData();

  if (telegramInitData) {
    const { profile } = await postJson<{ profile: SessionProfile }>("/api/auth/telegram", {
      initData: telegramInitData
    });
    return { status: "ready", initData: telegramInitData, profile, guest: false, error: "" };
  }

  const config = await getPublicConfig();

  if (!config.guestMode) {
    return { ...LOADING, status: "unavailable", error: OPEN_IN_TELEGRAM };
  }

  const { profile, token } = await postJson<{ profile: SessionProfile; token: string }>("/api/auth/guest", {
    token: readGuestToken()
  });
  saveGuestToken(token);
  return { status: "ready", initData: token, profile, guest: true, error: "" };
}

// One sign-in at a time: React may run the effect twice in development, which must not create two guests.
let inFlight: Promise<SessionState> | null = null;

function signInOnce(): Promise<SessionState> {
  inFlight ??= signIn().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Signs the visitor in: with Telegram initData inside Telegram, otherwise as a guest
 * (when the server allows guest mode). Every page uses this instead of talking to the auth routes itself.
 */
export function useSession(): Session {
  const [state, setState] = useState<SessionState>(LOADING);

  useEffect(() => {
    let cancelled = false;

    signInOnce()
      .then((next) => {
        if (!cancelled) {
          setState(next);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            ...LOADING,
            status: "unavailable",
            error: error instanceof Error ? error.message : "Не удалось войти."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ...state,
    setProfile: (profile) => setState((current) => ({ ...current, profile }))
  };
}
