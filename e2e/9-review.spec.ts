import { test, expect } from "@playwright/test";
import { signIn, record, recordToReview, viewer, play, mediaTime, origin, videoCount } from "./helpers";
import { fileOf, jumps, probe, timecodes, timecodeScreen } from "./media";

test.beforeEach(async ({ page }) => { await signIn(page); });

test("R3a nothing is uploaded until Save; Save cuts the file to the trim and removed section, drops muted sound, and uploads only that", async ({ page, browser }) => {
  await timecodeScreen(page);
  const before = await videoCount(page);
  let created = 0;
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/videos") created++; });
  await recordToReview(page, { mode: "Screen only", ms: 6500 });
  expect(created).toBe(0);
  expect(await videoCount(page)).toBe(before);
  await expect(page.getByTestId("trim-video")).toBeVisible();
  await expect(page.getByTestId("cut-note")).toContainText("uploads only the kept part");
  await page.getByRole("slider", { name: "Trim start" }).fill("1000");
  await page.getByRole("slider", { name: "Trim end" }).fill("5500");
  await expect(page.getByTestId("kept")).toHaveText("0:04 kept");
  await page.getByRole("button", { name: "Remove a section…" }).click();
  await page.getByRole("slider", { name: "Remove to" }).fill("3000");
  await page.getByRole("slider", { name: "Remove from" }).fill("2000");
  await page.getByRole("slider", { name: "Remove to" }).fill("3000");
  await expect(page.getByText("Removing 0:02–0:03")).toBeVisible();
  await expect(page.getByTestId("kept")).toHaveText("0:03 kept");
  // The preview plays only the kept parts.
  await page.getByRole("button", { name: "Play the kept part" }).click();
  await expect.poll(() => page.getByTestId("trim-video").evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 8000 }).toBeGreaterThan(3.1);
  await page.getByRole("button", { name: "Pause preview" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Reviewed before saving");
  await page.getByRole("checkbox", { name: "Mute audio" }).check({ force: true });
  await page.getByRole("button", { name: "Save video" }).click();
  await page.waitForURL(/\/v\/[0-9A-Za-z]{12}$/, { timeout: 60_000 });
  expect(created).toBe(1);
  const id = page.url().split("/v/")[1];
  const v = (await (await page.request.get(`/api/videos/${id}`)).json()).video;
  expect(v.title).toBe("Reviewed before saving");
  expect(v.contentType).toBe("video/mp4");
  expect(Math.abs(v.durationMs - 3500)).toBeLessThanOrEqual(50);
  expect(await page.evaluate(() => (window as any).__videoExport?.method)).toBe("webcodecs");
  await expect(page.getByTestId("time")).toHaveText("0:00 / 0:03");
  // The stored file is the cut: 3.5 s long, no sound, and the removed second is missing from the picture.
  const file = await fileOf(page, id);
  const info = probe(file);
  expect(info.duration).toBeGreaterThan(3.3); expect(info.duration).toBeLessThan(3.75);
  expect(info.hasAudio).toBe(false);
  const codes = timecodes(file);
  const big = jumps(codes);
  expect(big).toHaveLength(1);
  expect(big[0]).toBeGreaterThanOrEqual(8); expect(big[0]).toBeLessThanOrEqual(13); // ≈ the 1 s removed
  expect(codes[codes.length - 1] - codes[0]).toBeGreaterThanOrEqual(41); // 3.5 s kept + 1 s removed, in tenths
  expect(codes[codes.length - 1] - codes[0]).toBeLessThanOrEqual(49);
  // Viewers get the same file, including as a download, and the player has nothing to enforce.
  const w = await viewer(browser);
  await w.page.goto(`/v/${id}`);
  await expect(w.page.getByTestId("time")).toHaveText("0:00 / 0:03");
  const dl = await w.page.request.get(`/api/videos/${id}/media?download`);
  expect(dl.status()).toBe(200);
  expect(Buffer.from(await dl.body()).equals(file)).toBe(true);
  await w.ctx.close();
});

test("R3a Save without edits uploads the recording as it is", async ({ page }) => {
  await timecodeScreen(page);
  await page.evaluate(() => delete (window as any).__videoExport);
  const id = await record(page, { mode: "Screen only", ms: 3000 });
  expect(await page.evaluate(() => (window as any).__videoExport ?? null)).toBeNull();
  const info = probe(await fileOf(page, id));
  expect(info.hasAudio).toBe(true);
  expect(jumps(timecodes(await fileOf(page, id)))).toHaveLength(0);
});

test("R3a cutting can be cancelled, and the real-time fallback cuts too", async ({ page }) => {
  await timecodeScreen(page);
  await recordToReview(page, { mode: "Screen only", ms: 6000 });
  await page.evaluate(() => { (window as any).__exportMethod = "realtime"; });
  await page.getByRole("slider", { name: "Trim start" }).fill("1000");
  const before = await videoCount(page);
  await page.getByRole("button", { name: "Save video" }).click();
  await expect(page.getByTestId("save-progress")).toContainText("Cutting your video…");
  await page.getByTestId("save-progress").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Save video" })).toBeVisible();
  expect(await videoCount(page)).toBe(before);
  // Now let it run: MediaRecorder plays the kept part in real time.
  await page.getByRole("button", { name: "Remove a section…" }).click();
  await page.getByRole("slider", { name: "Remove to" }).fill("4000");
  await page.getByRole("slider", { name: "Remove from" }).fill("2500");
  await page.getByRole("slider", { name: "Remove to" }).fill("4000");
  await page.getByRole("button", { name: "Save video" }).click();
  await page.waitForURL(/\/v\/[0-9A-Za-z]{12}$/, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__videoExport?.method)).toBe("realtime");
  const id = page.url().split("/v/")[1];
  const file = await fileOf(page, id);
  const info = probe(file);
  const kept = (await (await page.request.get(`/api/videos/${id}`)).json()).video.durationMs / 1000;

  expect(Math.abs(info.duration - kept)).toBeLessThan(0.4);
  expect(info.hasAudio).toBe(true);
  const big = jumps(timecodes(file));
  expect(big).toHaveLength(1);
  expect(big[0]).toBeGreaterThanOrEqual(12); expect(big[0]).toBeLessThanOrEqual(19); // ≈ the 1.5 s removed
});

test("R3a discard and record again throws the recording away without uploading", async ({ page }) => {
  const before = await videoCount(page);
  await recordToReview(page, { mode: "Camera only", ms: 1500 });
  await page.getByRole("button", { name: "Discard and record again" }).click();
  await page.getByRole("dialog", { name: "Discard this recording?" }).getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  expect(await videoCount(page)).toBe(before);
});

test("R3b screen capture excludes this tab, allows switching and jumps to a shared tab", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any; w.__gdm = []; w.__focus = [];
    delete w.documentPictureInPicture; // floating controls are covered by their own test
    w.CaptureController = class { setFocusBehavior(b: string) { w.__focus.push(b); } };
    const real = MediaDevices.prototype.getDisplayMedia;
    MediaDevices.prototype.getDisplayMedia = async function (opts?: any) {
      w.__gdm.push({ ...opts, controller: !!opts?.controller });
      const s = await real.call(this, { video: opts.video, audio: opts.audio });
      const t = s.getVideoTracks()[0]; const g = t.getSettings.bind(t);
      t.getSettings = () => ({ ...g(), displaySurface: "browser" }); // pretend a tab was shared
      return s;
    };
  });
  await recordToReview(page, { mode: "Screen only", ms: 1500 });
  const gdm = await page.evaluate(() => (window as any).__gdm[0]);
  expect(gdm).toMatchObject({ selfBrowserSurface: "exclude", preferCurrentTab: false, surfaceSwitching: "include", monitorTypeSurfaces: "include", controller: true });
  expect(await page.evaluate(() => (window as any).__focus)).toEqual(["focus-captured-surface"]);
  await expect(page.getByText("Drag the handles to cut the start or end.")).toBeVisible();
});

test("R3b a whole-screen share says the start and end may show this page; Stop sharing ends the recording", async ({ page }) => {
  await page.addInitScript(() => {
    const real = MediaDevices.prototype.getDisplayMedia;
    MediaDevices.prototype.getDisplayMedia = async function (opts?: any) {
      const s = await real.call(this, opts); (window as any).__screen = s;
      const t = s.getVideoTracks()[0]; const g = t.getSettings.bind(t);
      t.getSettings = () => ({ ...g(), displaySurface: "monitor" });
      return s;
    };
  });
  await page.goto("/record");
  await page.getByRole("radio", { name: "Screen only" }).click();
  const cd = page.getByRole("checkbox", { name: "Countdown" });
  if (await cd.isChecked()) await cd.click({ force: true });
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("rec-time")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  // The browser's own "Stop sharing" ends the track; the recording stops and goes to review.
  await page.evaluate(() => { const t = (window as any).__screen.getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event("ended")); });
  await expect(page.getByRole("heading", { name: "Review your recording" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/You shared a whole screen/)).toBeVisible();
});

test("R3b the keyboard shortcut Alt+Shift+S stops the recording", async ({ page }) => {
  await page.goto("/record");
  await page.getByRole("radio", { name: "Camera only" }).click();
  const cd = page.getByRole("checkbox", { name: "Countdown" });
  if (await cd.isChecked()) await cd.click({ force: true });
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("rec-time")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press("Alt+Shift+KeyS");
  await expect(page.getByRole("heading", { name: "Review your recording" })).toBeVisible({ timeout: 20_000 });
});

test("R3b floating controls (Document Picture-in-Picture) open after picking a screen and can stop the recording", async ({ page, context }) => {
  test.skip(!(await page.evaluate(() => "documentPictureInPicture" in window)), "no Document Picture-in-Picture in this browser");
  await page.goto("/record");
  await page.getByRole("radio", { name: "Screen only" }).click();
  const cd = page.getByRole("checkbox", { name: "Countdown" });
  if (await cd.isChecked()) await cd.click({ force: true });
  const pipPage = context.waitForEvent("page");
  await page.getByRole("button", { name: "Start recording" }).click();
  const pip = await pipPage;
  await expect(pip.getByRole("toolbar", { name: "Recording controls" })).toBeVisible();
  await expect(pip.locator(".pip-time")).not.toHaveText("0:00", { timeout: 5000 });
  await pip.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await pip.getByRole("button", { name: "Resume" }).click();
  await pip.getByRole("button", { name: /Stop/ }).click();
  await expect(page.getByRole("heading", { name: "Review your recording" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => pip.isClosed()).toBe(true);
});
