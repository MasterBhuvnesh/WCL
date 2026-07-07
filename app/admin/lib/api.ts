/**
 * Small client-side fetch helper for the admin API. All new admin screens run
 * in the browser and talk to the Bun/Express API at NEXT_PUBLIC_API_BASE. The
 * admin token is kept in localStorage and attached as a Bearer header.
 *
 * ponytail: localStorage token + client-side guard is enough for an on-center
 * admin panel; swap for httpOnly cookies + SSR auth if this ever ships public.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

/** Default exam the API falls back to (see DEFAULT_EXAM_ID in the API). */
export const DEFAULT_EXAM_ID = "WCL-EXAM";

const TOKEN_KEY = "wcl-admin-token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

/** Thrown by apiFetch on a non-2xx response; carries the HTTP status. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Fetch JSON from the admin API with the Bearer token attached. Throws
 * ApiError on a non-2xx response, using the API's `{ error }` message.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON body; keep the status text.
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** WebSocket URL for the admin live feed, with the token as a query param. */
export function adminWsUrl(): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/admin/ws?token=${encodeURIComponent(getToken() ?? "")}`;
}
