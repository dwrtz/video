import { HttpError } from "./http";
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
export const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

const ITER = 100_000; // the most PBKDF2 iterations Workers allow
async function derive(pw: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: ITER }, key, 256));
}
export async function hashPassword(pw: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2-sha256$${ITER}$${salt}$${hex(await derive(pw, salt))}`;
}
export async function checkPassword(pw: string, stored: string) {
  const [alg, n, salt, h] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || Number(n) !== ITER || !/^[a-f0-9]{64}$/.test(h)) return false;
  const got = await derive(pw, salt);
  const want = Uint8Array.from(h.match(/../g)!, x => parseInt(x, 16));
  return (crypto.subtle as any).timingSafeEqual(got, want);
}
/** State-changing requests must come from this site's own pages. */
export function checkOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin !== new URL(req.url).origin) throw new HttpError(403, "Cross-site request refused");
}
/** Rate limits are always the last check, so refused requests don't use up the allowance. */
export async function limit(binding: RateLimit | undefined, key: string) {
  if (!binding) return;
  const { success } = await binding.limit({ key });
  if (!success) throw new HttpError(429, "Too many requests. Try again in a minute.");
}
export const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? "local";
