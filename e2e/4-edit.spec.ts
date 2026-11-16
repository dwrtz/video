import { test, expect } from "@playwright/test";
import { signIn, record, viewer, play, mediaTime, origin } from "./helpers";

test.beforeEach(async ({ page }) => { await signIn(page); });

test("R7 R8 R13 owner renames, trims and adds chapters; viewers see only the kept part", async ({ page, browser }) => {
  const id = await record(page, { mode: "Screen only", ms: 7000 });
  await page.getByTestId("video-title").dblclick();
  await page.getByRole("textbox", { name: "Video title" }).fill("Q4 roadmap walkthrough");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("video-title")).toHaveText("Q4 roadmap walkthrough");
  await page.getByRole("button", { name: "Edit video" }).click();
  const dlg = page.getByRole("dialog", { name: "Edit video" });
  await dlg.getByRole("slider", { name: "Trim start" }).fill("1000");
  await dlg.getByRole("slider", { name: "Trim end" }).fill("6000");
  await expect(dlg.getByText("0:05 kept")).toBeVisible();
  await dlg.getByLabel("Chapters").fill("0:09 Too late");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByRole("alert")).toContainText("past the end of the video");
  await dlg.getByLabel("Chapters").fill("0:01 Intro\n0:04 The details");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId("time")).toHaveText("0:00 / 0:05");
  const v = await viewer(browser);
  await v.page.goto(`/v/${id}`);
  await expect(v.page.getByTestId("time")).toHaveText("0:00 / 0:05");
  await expect.poll(() => mediaTime(v.page)).toBeGreaterThanOrEqual(0.99);
  await v.page.getByRole("tab", { name: /Chapters/ }).click();
  await expect(v.page.locator(".chapters li")).toHaveCount(2);
  await expect(v.page.locator(".chapters li").nth(1)).toContainText("0:03The details");
  await expect(v.page.locator(".seg-part")).toHaveCount(2);
  await v.page.locator(".chapters li").nth(1).getByRole("button").click();
  await expect(v.page.getByTestId("chapter-now")).toHaveText("· The details");
  // Playback stops at the trim end.
  await v.page.getByRole("slider", { name: "Seek" }).fill("4500");
  if (!(await v.page.getByRole("button", { name: "Pause, keyboard shortcut K" }).isVisible())) await play(v.page);
  await expect(v.page.getByRole("button", { name: "Replay" })).toBeVisible({ timeout: 8000 });
  expect(await mediaTime(v.page)).toBeLessThanOrEqual(6.05);
  // Untrim: widening back to the full length works.
  expect((await page.request.patch(`/api/videos/${id}`, { data: { trimStartMs: 0, trimEndMs: null }, headers: origin(page) })).status()).toBe(200);
  expect((await page.request.patch(`/api/videos/${id}`, { data: { trimStartMs: 3000, trimEndMs: 3500 }, headers: origin(page) })).status()).toBe(400);
  await v.ctx.close();
});

test("R13 comments and downloads can be turned off; delete removes the video for everyone", async ({ page, browser }) => {
  const id = await record(page, { mode: "Camera only", ms: 2000 });
  const v = await viewer(browser);
  await v.page.goto(`/v/${id}`);
  const dl = await v.page.request.get(`/api/videos/${id}/media?download`);
  expect(dl.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.webm"$/);
  await page.getByRole("button", { name: "Edit video" }).click();
  await page.getByRole("checkbox", { name: "Allow comments" }).uncheck({ force: true });
  await page.getByRole("checkbox", { name: "Allow downloads" }).uncheck({ force: true });
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await v.page.reload();
  await expect(v.page.getByText("Comments are turned off for this video.")).toBeVisible();
  await expect(v.page.getByRole("link", { name: "Download" })).toHaveCount(0);
  expect((await v.page.request.get(`/api/videos/${id}/media?download`)).status()).toBe(403);
  expect((await v.page.request.get(`/api/videos/${id}/media`)).status()).toBe(200);
  const post = await v.page.request.post(`/api/videos/${id}/comments`, { data: { name: "X", body: "hi" }, headers: { ...origin(v.page), "x-viewer": "B".repeat(22) } });
  expect(post.status()).toBe(403);
  await page.getByRole("button", { name: "Delete video" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "My videos" })).toBeVisible();
  await v.page.reload();
  await expect(v.page.getByRole("heading", { name: "Video not found" })).toBeVisible();
  expect((await v.page.request.get(`/api/videos/${id}/media`)).status()).toBe(404);
  await v.ctx.close();
});
