"use client";

import { useEffect, useState } from "react";

import { postJson } from "./api";

export function usePresenceCount(initData: string, refreshMs = 30000): number | null {
  const [onlinePlayers, setOnlinePlayers] = useState<number | null>(null);

  useEffect(() => {
    if (!initData) {
      setOnlinePlayers(null);
      return;
    }

    let cancelled = false;

    async function syncPresence() {
      try {
        const payload = await postJson<{ onlinePlayers: number }>("/api/presence", { initData });

        if (!cancelled) {
          setOnlinePlayers(payload.onlinePlayers);
        }
      } catch {
        if (!cancelled) {
          setOnlinePlayers((current) => current ?? 0);
        }
      }
    }

    void syncPresence();
    const timer = window.setInterval(() => {
      void syncPresence();
    }, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [initData, refreshMs]);

  return onlinePlayers;
}
