import { requestJson } from "./api";

export type PublicConfig = {
  guestMode: boolean;
  botUsername: string;
  wsUrl: string;
};

let cached: Promise<PublicConfig> | null = null;

/** Settings from GET /api/config, fetched once per page load. */
export function getPublicConfig(): Promise<PublicConfig> {
  cached ??= requestJson<PublicConfig>("/api/config", { cache: "no-store" }).catch((error) => {
    cached = null;
    throw error;
  });

  return cached;
}
