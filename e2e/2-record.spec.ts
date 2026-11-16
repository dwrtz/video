import { test, expect } from "@playwright/test";
import { signIn, record, mediaTime } from "./helpers";

test.beforeEach(async ({ page }) => { await signIn(page); });

test("R3 R4 R5 screen + camera: countdown, pause/resume, review, upload, then the share page plays a seekable MP4", async ({ page }) => {
  await page.goto("/record");
  await page.getByRole("radio", { name: "Screen + camera" }).click();
  await expect(page.getByTestId("bubble")).toBeVisible();
  const cd = page.getByRole("checkbox", { name: "Countdown" });
  if (!(await cd.isChecked())) await cd.click({ force: true });
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("button", { name: "Skip countdown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip countdown" })).toContainText("3");
  await expect(page.getByTestId("rec-time")).toBeVisible({ timeout: 6000 });
  await expect(page.getByTestId("live-preview")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await page.getByTestId("rec-time").textContent();
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("rec-time")).toHaveText(paused!);
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Review your recording" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Save video" }).click();
  await expect(page.getByText(/Uploading your video|Opening your video/)).toBeVisible();
  await page.waitForURL(/\/v\/[0-9A-Za-z]{12}$/, { timeout: 30_000 });
  const id = page.url().split("/v/")[1];
  // Duration excludes the paused time (≈3.5 s, not 6).
  await expect(page.getByTestId("time")).toHaveText(/^0:00 \/ 0:0[345]$/);
  const meta = await (await page.request.get(`/api/videos/${id}`)).json();
  expect(meta.video.durationMs).toBeGreaterThan(2800);
  expect(meta.video.durationMs).toBeLessThan(5000);
  expect(meta.video.mode).toBe("screen_camera");
  expect(meta.video.width / meta.video.height).toBeCloseTo(16 / 9, 2);
  expect(meta.video.hasThumbnail).toBe(true);
  // Chromium records MP4 (H.264) when it can, which phones play; WebM is the fallback.
  expect(meta.video.contentType).toBe("video/mp4");
  expect((await page.request.get(`/api/videos/${id}/media`, { headers: { range: "bytes=0-11" } })).headers()["content-type"]).toBe("video/mp4");
  // The file carries its duration, so the browser can seek.
  const dur = await page.getByTestId("video").evaluate((v: HTMLVideoElement) => new Promise<number>(r => v.readyState ? r(v.duration) : v.addEventListener("loadedmetadata", () => r(v.duration))));
  expect(Number.isFinite(dur)).toBe(true);
  await page.getByRole("slider", { name: "Seek" }).fill("2000");
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(1.8);
  const head = await page.request.get(`/api/videos/${id}/media`, { headers: { range: "bytes=0-99" } });
  expect(head.status()).toBe(206);
  expect(head.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
  expect((await head.body()).length).toBe(100);
  const thumb = await page.request.get(`/api/videos/${id}/thumbnail`);
  expect(thumb.headers()["content-type"]).toBe("image/jpeg");
});

test("R3 screen only and camera only record at the source size", async ({ page }) => {
  const a = await record(page, { mode: "Screen only", ms: 2000 });
  const va = (await (await page.request.get(`/api/videos/${a}`)).json()).video;
  expect(va.mode).toBe("screen");
  expect(va.width / va.height).toBeCloseTo(16 / 9, 2);
  const b = await record(page, { mode: "Camera only", ms: 2000 });
  const vb = (await (await page.request.get(`/api/videos/${b}`)).json()).video;
  expect(vb.mode).toBe("camera");
  // The recorded size matches what the camera delivers.
  expect(vb.width).toBeGreaterThan(0);
  const dims = await page.getByTestId("video").evaluate((v: HTMLVideoElement) => new Promise<number[]>(r => { const f = () => r([v.videoWidth, v.videoHeight]); v.readyState ? f() : v.addEventListener("loadedmetadata", f); }));
  expect(dims).toEqual([vb.width, vb.height]);
});

test("R3 restart resets the timer; cancel discards without creating a video", async ({ page }) => {
  const before = (await (await page.request.get("/api/videos")).json()).videos.length;
  await page.goto("/record");
  await page.getByRole("radio", { name: "Screen only" }).click();
  const cd = page.getByRole("checkbox", { name: "Countdown" });
  if (await cd.isChecked()) await cd.click({ force: true });
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.getByTestId("rec-time")).toHaveText("0:00");
  await page.getByRole("button", { name: "Cancel recording" }).click();
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  expect((await (await page.request.get("/api/videos")).json()).videos.length).toBe(before);
});

test("R3 the camera bubble can be dragged and resized, and the choice is remembered", async ({ page }) => {
  await page.goto("/record");
  await page.getByRole("radio", { name: "Screen + camera" }).click();
  const bubble = page.getByTestId("bubble");
  const stage = await page.getByTestId("stage").boundingBox();
  const b0 = (await bubble.boundingBox())!;
  expect(b0.x - stage!.x).toBeLessThan(stage!.width / 4);
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage!.x + stage!.width - 20, stage!.y + 20, { steps: 8 });
  await page.mouse.up();
  const b1 = (await bubble.boundingBox())!;
  expect(b1.x + b1.width).toBeLessThanOrEqual(stage!.x + stage!.width);
  expect(b1.x).toBeGreaterThan(stage!.x + stage!.width / 2);
  await page.getByRole("radio", { name: "L", exact: true }).click();
  expect((await bubble.boundingBox())!.width).toBeGreaterThan(b1.width);
  await page.reload();
  expect((await bubble.boundingBox())!.x).toBeGreaterThan(stage!.x + stage!.width / 2);
});
