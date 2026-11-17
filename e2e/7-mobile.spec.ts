import { test, expect } from "@playwright/test";
import { signIn, record, play } from "./helpers";
import { fileOf, probe } from "./media";

const noOverflow = async (page: import("@playwright/test").Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test("R15 phones: sign-in, library and share page fit the screen; the player and comments work by touch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await noOverflow(page);
  await signIn(page, "owner@example.com");
  await noOverflow(page);
  const id = await record(page, { mode: "Camera only", ms: 2000, review: async p => { await expect(p.getByRole("button", { name: "Save video" })).toBeVisible(); await noOverflow(p); } });
  expect((await (await page.request.get(`/api/videos/${id}`)).json()).video.contentType).toBe("video/mp4");
  await noOverflow(page);
  const player = await page.getByTestId("player").boundingBox();
  const vw = page.viewportSize()!.width;
  expect(Math.round(player!.width)).toBe(vw);
  await page.getByRole("button", { name: /^Play, keyboard shortcut K/ }).first().tap();
  await expect(page.getByTestId("time")).not.toHaveText(/^0:00 \//, { timeout: 8000 });
  await page.getByRole("button", { name: "React 👏" }).tap();
  await expect(page.getByRole("button", { name: "React 👏" })).toContainText("1");
  await page.getByLabel("Comment", { exact: true }).fill("Looks great on my phone");
  await page.getByRole("button", { name: "Post" }).tap();
  await expect(page.getByTestId("comment").filter({ hasText: "Looks great on my phone" })).toBeVisible();
  await noOverflow(page);
  await page.goto("/");
  await expect(page.getByTestId("video-card").first()).toBeVisible();
  await noOverflow(page);
});

test("R15 phones without screen capture offer camera recording only", async ({ page }) => {
  await page.addInitScript(() => { delete (MediaDevices.prototype as any).getDisplayMedia; });
  await signIn(page, "owner@example.com");
  await page.goto("/record");
  await expect(page.getByRole("radio", { name: "Camera only" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Screen + camera" })).toBeDisabled();
  await expect(page.getByTestId("no-screen-note")).toHaveText("Phones and tablets can't share their screen from a browser, so this device records with its camera.");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await noOverflow(page);
});

test("R3a R15 phones: a trimmed camera recording is cut before upload and saved as MP4", async ({ page }) => {
  await page.addInitScript(() => { delete (MediaDevices.prototype as any).getDisplayMedia; });
  await signIn(page, "owner@example.com");
  await page.goto("/record");
  const cd = page.getByRole("checkbox", { name: "Countdown" });
  if (await cd.isChecked()) await cd.click({ force: true });
  await page.getByRole("button", { name: "Start recording" }).tap();
  await expect(page.getByTestId("rec-time")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "Finish" }).tap();
  await expect(page.getByRole("heading", { name: "Review your recording" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("cut-note")).toBeVisible();
  await page.getByRole("slider", { name: "Trim start" }).fill("1000");
  await noOverflow(page);
  await page.getByRole("button", { name: "Save video" }).tap();
  await page.waitForURL(/\/v\/[0-9A-Za-z]{12}$/, { timeout: 60_000 });
  const id = page.url().split("/v/")[1];
  const v = (await (await page.request.get(`/api/videos/${id}`)).json()).video;
  const info = probe(await fileOf(page, id));
  expect(info.format).toContain("mp4");
  expect(Math.abs(info.duration - v.durationMs / 1000)).toBeLessThan(0.3);
  expect(v.durationMs).toBeGreaterThan(2500); expect(v.durationMs).toBeLessThan(3600);
});
