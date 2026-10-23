/** Small fetch helpers shared by the pages. Errors carry the server's message. */

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    // Not JSON (for example a gateway error page): handled below.
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

export function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal
  });
}
