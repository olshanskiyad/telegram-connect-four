/**
 * Address of the WebSocket server with query parameters.
 * baseUrl is WS_PUBLIC_URL from /api/config; when empty the page's own host and path /ws are used
 * (a reverse proxy sends /ws to the WebSocket server, see deploy/nginx.example.conf).
 */
export function createLiveSocketUrl(
  params: Record<string, string | number | null | undefined>,
  baseUrl = ""
): string {
  if (typeof window === "undefined") {
    return "";
  }

  const url = baseUrl
    ? new URL(baseUrl)
    : new URL(`${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`);

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

export function safeParseJson<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}
