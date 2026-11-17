import { test, expect } from "@playwright/test";
import { signIn, record, viewer, origin } from "./helpers";
import { fileOf, jumps, localObjectExists, localSql, probe, timecodes, timecodeScreen } from "./media";

test.beforeEach(async ({ page }) => { await signIn(page); });

test("R7 R8 R13 owner renames, cuts and adds chapters; the stored file is replaced by the cut and comments, reactions and chapters move with it", async ({ page, browser }) => {
  await timecodeScreen(page);
  const id = await record(page, { mode: "Screen only", ms: 7000 });
  const before = probe(await fileOf(page, id));
  const D = (await (await page.request.get(`/api/videos/${id}`)).json()).video.durationMs as number;
  expect(localObjectExists(`videos/${id}/video`)).toBe(true);
  // A viewer comments and reacts at times that will be kept, cut out and shifted.
  const v = await viewer(browser);
  await v.page.goto(`/v/${id}`);
  const vh = { ...origin(v.page), "x-viewer": "C".repeat(22) };
  const comment = async (timeMs: number, body: string) => expect((await v.page.request.post(`/api/videos/${id}/comments`, { data: { name: "Sam", body, timeMs }, headers: vh })).status()).toBe(201);
  await comment(500, "in the trimmed start"); await comment(2500, "kept, before the cut"); await comment(3500, "inside the cut"); await comment(5000, "after the cut");
  for (const timeMs of [3200, 4500]) expect((await v.page.request.post(`/api/videos/${id}/reactions`, { data: { emoji: "👍", timeMs }, headers: vh })).status()).toBe(201);

  await page.getByTestId("video-title").dblclick();
  await page.getByRole("textbox", { name: "Video title" }).fill("Q4 roadmap walkthrough");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("video-title")).toHaveText("Q4 roadmap walkthrough");
  await page.getByRole("button", { name: "Edit video" }).click();
  const dlg = page.getByRole("dialog", { name: "Edit video" });
  await expect(dlg.getByText("It can't be undone.")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await dlg.getByRole("slider", { name: "Trim start" }).fill("1000");
  await dlg.getByRole("slider", { name: "Trim end" }).fill("6000");
  await expect(dlg.getByText("0:05 kept")).toBeVisible();
  await dlg.getByRole("button", { name: "Remove a section" }).click();
  await dlg.getByRole("slider", { name: "Remove from" }).fill("3000");
  await dlg.getByRole("slider", { name: "Remove to" }).fill("4000");
  await dlg.getByLabel("Chapters").fill("0:09 Too late");
  await dlg.getByRole("button", { name: "Save…" }).click();
  await expect(dlg.getByRole("alert")).toContainText("past the end of the video");
  await dlg.getByLabel("Chapters").fill("0:00 Hello\n0:01 Intro\n0:03 Cut\n0:04 The details");
  await dlg.getByRole("button", { name: "Save…" }).click();
  // A last warning, then the cut.
  const confirm = page.getByTestId("cut-confirm");
  await expect(confirm).toContainText("This can't be undone.");
  await confirm.getByRole("button", { name: "Back" }).click();
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Save…" }).click();
  await confirm.getByRole("button", { name: "Cut and save" }).click();
  await expect(confirm).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId("time")).toHaveText("0:00 / 0:04");

  // The stored file is now only the kept 4 s (1-3 s and 4-6 s), with sound, and the old file is gone.
  const after = await (await page.request.get(`/api/videos/${id}`)).json();
  expect(Math.abs(after.video.durationMs - (D > 6000 ? 4000 : D - 2000))).toBeLessThan(100);
  const file = await fileOf(v.page, id);
  const info = probe(file);
  expect(Math.abs(info.duration - 4)).toBeLessThan(0.3);
  expect(info.hasAudio).toBe(before.hasAudio);
  const codes = timecodes(file);
  expect(codes[0]).toBeGreaterThanOrEqual(9); expect(codes[0]).toBeLessThanOrEqual(12);
  const big = jumps(codes); expect(big).toHaveLength(1); expect(big[0]).toBeGreaterThanOrEqual(8); expect(big[0]).toBeLessThanOrEqual(13);
  expect(codes.at(-1)!).toBeLessThanOrEqual(61);
  const key = localSql<{ media_key: string }>(`SELECT media_key FROM videos WHERE id = '${id}'`)[0].media_key;
  expect(key).toMatch(new RegExp(`^videos/${id}/v-`));
  expect(localObjectExists(`videos/${id}/video`)).toBe(false);
  expect(localObjectExists(key)).toBe(true);

  // Chapters, comments and reactions moved with the picture.
  expect(after.video.chapters).toEqual([{ timeMs: 0, title: "Intro" }, { timeMs: 2000, title: "The details" }]);
  expect(after.video.reactions.map((r: any) => r.timeMs)).toEqual([2500]);
  const cs = (await (await v.page.request.get(`/api/videos/${id}/comments`, { headers: vh })).json()).comments;
  expect(Object.fromEntries(cs.map((c: any) => [c.body, c.timeMs]))).toEqual({ "in the trimmed start": null, "kept, before the cut": 1500, "inside the cut": null, "after the cut": 3000 });
  await v.page.reload();
  await expect(v.page.getByTestId("time")).toHaveText("0:00 / 0:04");
  await v.page.getByRole("tab", { name: /Chapters/ }).click();
  await expect(v.page.locator(".chapters li")).toHaveCount(2);
  await expect(v.page.locator(".chapters li").nth(1)).toContainText("0:02The details");

  // A second edit mutes it: another new file without sound, and the first cut is deleted too.
  await page.getByRole("button", { name: "Edit video" }).click();
  await expect(dlg.getByRole("slider", { name: "Trim end" })).toHaveValue(String(after.video.durationMs));
  await dlg.getByRole("checkbox", { name: "Mute audio" }).check({ force: true });
  await dlg.getByRole("button", { name: "Save…" }).click();
  await expect(confirm).toContainText("and no sound");
  await confirm.getByRole("button", { name: "Cut and save" }).click();
  await expect(confirm).toHaveCount(0, { timeout: 60_000 });
  const muted = probe(await fileOf(v.page, id));
  expect(muted.hasAudio).toBe(false);
  expect(Math.abs(muted.duration - info.duration)).toBeLessThan(0.3);
  const key2 = localSql<{ media_key: string }>(`SELECT media_key FROM videos WHERE id = '${id}'`)[0].media_key;
  expect(key2).not.toBe(key);
  expect(localObjectExists(key)).toBe(false);
  // Viewers get the cut as it is: there are no playback-time edits left in the API.
  const final = (await (await v.page.request.get(`/api/videos/${id}`)).json()).video;
  for (const k of ["trimStartMs", "trimEndMs", "cutStartMs", "cutEndMs", "muted"]) expect(final).not.toHaveProperty(k);
  await v.ctx.close();
});

test("R7 cancelling a cut leaves the video as it was", async ({ page }) => {
  const id = await record(page, { mode: "Screen only", ms: 4000 });
  await page.evaluate(() => { (window as any).__exportMethod = "realtime"; });
  await page.getByRole("button", { name: "Edit video" }).click();
  const dlg = page.getByRole("dialog", { name: "Edit video" });
  await dlg.getByRole("slider", { name: "Trim start" }).fill("1000");
  await dlg.getByRole("button", { name: "Save…" }).click();
  const confirm = page.getByTestId("cut-confirm");
  await confirm.getByRole("button", { name: "Cut and save" }).click();
  await expect(confirm.getByText("Cutting your video…")).toBeVisible({ timeout: 20_000 });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Cancelled. The video wasn't changed");
  expect(localObjectExists(`videos/${id}/video`)).toBe(true);
  expect(localSql<{ media_key: string | null; pending_key: string | null }>(`SELECT media_key, pending_key FROM videos WHERE id = '${id}'`)[0]).toEqual({ media_key: null, pending_key: null });
});

test("R13 comments and downloads can be turned off; delete removes the video for everyone", async ({ page, browser }) => {
  const id = await record(page, { mode: "Camera only", ms: 2000 });
  const v = await viewer(browser);
  await v.page.goto(`/v/${id}`);
  const dl = await v.page.request.get(`/api/videos/${id}/media?download`);
  expect(dl.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.mp4"$/);
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
