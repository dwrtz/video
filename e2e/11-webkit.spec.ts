import { test, expect, chromium } from "@playwright/test";
import { PASSWORD } from "./helpers";

// Runs in the "webkit-iphone" project: Playwright's WebKit with the iPhone 13 profile.
// WebKit here can't record (no MediaRecorder formats on Linux), so a Chromium browser records the video.
const mediaArgs = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--autoplay-policy=no-user-gesture-required"];

test("R3a R15 WebKit (iPhone 13): a video cut before upload plays, seeks and has the cut length on a share page", async ({ page, baseURL }) => {
  const chrome = await chromium.launch({ args: mediaArgs });
  const ctx = await chrome.newContext({ baseURL, permissions: ["camera", "microphone"] });
  const p = await ctx.newPage();
  await p.goto("/");
  const o = { origin: new URL(p.url()).origin };
  const email = "owner@example.com";
  const r = await p.request.post("/api/auth/signup", { data: { email, name: "Dana Owner", password: PASSWORD }, headers: o });
  if (r.status() === 409) expect((await p.request.post("/api/auth/signin", { data: { email, password: PASSWORD }, headers: o })).status()).toBe(200);
  await p.goto("/record");
  await p.getByRole("radio", { name: "Screen + camera" }).click();
  const cd = p.getByRole("checkbox", { name: "Countdown" });
  if (await cd.isChecked()) await cd.click({ force: true });
  await expect(p.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await p.getByRole("button", { name: "Start recording" }).click();
  await expect(p.getByTestId("rec-time")).toBeVisible({ timeout: 15_000 });
  await p.waitForTimeout(4000);
  await p.getByRole("button", { name: "Finish" }).click();
  await p.getByRole("slider", { name: "Trim start" }).fill("500");
  await p.getByRole("button", { name: "Remove a section" }).click();
  await p.getByRole("slider", { name: "Remove from" }).fill("1500");
  await p.getByRole("slider", { name: "Remove to" }).fill("2500");
  await p.getByRole("button", { name: "Save video" }).click();
  await p.waitForURL(/\/v\/[0-9A-Za-z]{12}$/, { timeout: 30_000 });
  const id = p.url().split("/v/")[1];
  const kept = (await (await p.request.get(`/api/videos/${id}`)).json()).video.durationMs / 1000;
  await chrome.close();

  await page.goto(`/v/${id}`);
  await expect(page.getByTestId("format-notice")).toHaveCount(0);
  await page.getByRole("button", { name: /^Play, keyboard shortcut K/ }).first().tap();
  await expect.poll(() => page.getByTestId("video").evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(1);
  const st = await page.getByTestId("video").evaluate((v: HTMLVideoElement) => ({ err: v.error?.code ?? null, dur: v.duration, w: v.videoWidth }));
  expect(st.err).toBeNull();
  expect(Math.abs(st.dur - kept)).toBeLessThan(0.3);
  expect(kept).toBeGreaterThan(1.4); expect(kept).toBeLessThan(3);
  expect(st.w).toBeGreaterThan(0);
  await page.getByRole("slider", { name: "Seek" }).fill("1500");
  await expect.poll(() => page.getByTestId("video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.4);
});
