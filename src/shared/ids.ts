const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Random base62 id (rejection sampling, so every character is equally likely). */
export function randomId(len = 12): string {
  let out = "";
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < 248 && out.length < len) out += ALPHABET[b % 62];
    }
  }
  return out;
}
export const isVideoId = (s: string) => /^[0-9A-Za-z]{12}$/.test(s);
export const isViewerId = (s: unknown): s is string => typeof s === "string" && /^[0-9A-Za-z]{22}$/.test(s);
