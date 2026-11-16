import { expect, type Page, type BrowserContext, type Browser } from "@playwright/test";

export const PASSWORD = "correct horse 42";
let n = 0;

const sessions = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
/** Signs up (or signs in, if the account exists). Sessions are reused within a test run, to stay under the sign-in rate limit. */
export async function signIn(page: Page, email = "owner@example.com", name = "Dana Owner") {
  await page.goto("/");
  const saved = sessions.get(email + new URL(page.url()).origin);
  if (saved) {
    await page.context().clearCookies();
    await page.context().addCookies(saved);
    await page.goto("/");
    if (await page.getByRole("heading", { name: "My videos" }).isVisible({ timeout: 5000 }).catch(() => false)) return;
  }
  const r = await page.request.post("/api/auth/signup", { data: { email, name, password: PASSWORD }, headers: { origin: new URL(page.url()).origin } });
  if (r.status() === 409) {
    const s = await page.request.post("/api/auth/signin", { data: { email, password: PASSWORD }, headers: { origin: new URL(page.url()).origin } });
    expect(s.status()).toBe(200);
  } else expect(r.status()).toBe(200);
  sessions.set(email + new URL(page.url()).origin, (await page.context().cookies()).filter(c => c.name === "sid"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My videos" })).toBeVisible();
}

/** Records `ms` of video in a mode through the real recorder, and returns the new video's id. */
export async function record(page: Page, opts: { mode?: "Screen + camera" | "Screen only" | "Camera only"; ms?: number; countdown?: boolean } = {}) {
  await page.goto("/record");
  await page.getByRole("radio", { name: opts.mode ?? "Screen + camera" }).click();
  const cd = page.getByRole("checkbox", { name: "Countdown" });
  if ((await cd.isChecked()) !== !!opts.countdown) await cd.click({ force: true });
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("rec-time")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(opts.ms ?? 3000);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL(/\/v\/[0-9A-Za-z]{12}$/, { timeout: 30_000 });
  await expect(page.getByTestId("video-title")).toBeVisible();
  return page.url().split("/v/")[1];
}

export async function viewer(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

export async function play(page: Page) {
  await page.getByRole("button", { name: /^Play, keyboard shortcut K/ }).first().click();
}
export const mediaTime = (page: Page) => page.getByTestId("video").evaluate((v: HTMLVideoElement) => v.currentTime);
export const origin = (page: Page) => ({ origin: new URL(page.url()).origin });
export const uniq = () => `${Date.now().toString(36)}${n++}`;
