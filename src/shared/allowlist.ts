/** ALLOWED_EMAILS: comma-separated, case-insensitive. Empty means anyone may have an account. */
export function parseAllowlist(raw: unknown): string[] {
  return String(raw ?? "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
}
export function emailAllowed(list: string[], email: unknown): boolean {
  return !list.length || (typeof email === "string" && list.includes(email.trim().toLowerCase()));
}
export const NOT_ALLOWED = "This site only accepts accounts for approved email addresses.";
