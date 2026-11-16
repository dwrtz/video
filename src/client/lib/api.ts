import type { Me } from "../../shared/types";
export class ApiError extends Error { constructor(public status: number, message: string, public fields?: Record<string, string>) { super(message); } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-viewer": viewerId(), ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.fields);
  return data as T;
}
export const getMe = () => api<{ user: Me | null }>("/api/me").then(r => r.user);

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** A random id for this browser, used to count views once and to let people delete their own comments. */
export function viewerId(): string {
  let v = localStorage.getItem("av.viewer");
  if (!v || !/^[0-9A-Za-z]{22}$/.test(v)) {
    v = Array.from(crypto.getRandomValues(new Uint8Array(22)), b => B62[b % 62]).join("");
    localStorage.setItem("av.viewer", v);
  }
  return v;
}
export const shareUrl = (id: string) => `${location.origin}/v/${id}`;
export function relativeDate(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) { const d = Math.floor(s / 86400); return `${d} day${d > 1 ? "s" : ""} ago`; }
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
