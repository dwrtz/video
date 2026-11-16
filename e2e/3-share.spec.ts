import { test, expect } from "@playwright/test";
import { signIn, record, viewer, play, mediaTime } from "./helpers";

let id = "";
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  await signIn(page);
  id = await record(page, { mode: "Screen + camera", ms: 6000 });
  await ctx.close();
});

test("R6 R11 anyone with the link can watch; a view counts once per viewer after 2 s, never for the owner", async ({ browser, page }) => {
  const v = await viewer(browser);
  await v.page.goto(`/v/${id}`);
  await expect(v.page.getByTestId("video-title")).toBeVisible();
  await expect(v.page.getByRole("button", { name: "Edit video" })).toHaveCount(0);
  await expect(v.page.getByTestId("views")).toHaveText(/0 views/);
  await play(v.page);
  await expect(v.page.getByTestId("views")).toHaveText(/1 view$/, { timeout: 8000 });
  await v.page.reload();
  await play(v.page);
  await v.page.waitForTimeout(3000);
  expect((await (await v.page.request.get(`/api/videos/${id}`)).json()).video.viewCount).toBe(1);
  await signIn(page);
  await page.goto(`/v/${id}`);
  await play(page);
  await page.waitForTimeout(3000);
  expect((await (await page.request.get(`/api/videos/${id}`)).json()).video.viewCount).toBe(1);
  await v.ctx.close();
});

test("R6 player controls: speed menu with lengths, keyboard shortcuts, ?t= start", async ({ browser }) => {
  const v = await viewer(browser);
  await v.page.goto(`/v/${id}`);
  await v.page.getByRole("button", { name: "Playback speed, keyboard shortcut S" }).click();
  const menu = v.page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio")).toHaveCount(7);
  await expect(menu.getByRole("menuitemradio", { name: /^2×/ })).toContainText("0:03");
  await menu.getByRole("menuitemradio", { name: /^2×/ }).click();
  expect(await v.page.getByTestId("video").evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(2);
  await v.page.keyboard.press("s");
  await expect(v.page.getByRole("button", { name: "Playback speed, keyboard shortcut S" })).toHaveText("2.5×");
  await v.page.keyboard.press("m");
  expect(await v.page.getByTestId("video").evaluate((el: HTMLVideoElement) => el.muted)).toBe(true);
  await v.page.keyboard.press("l");
  await expect.poll(() => mediaTime(v.page)).toBeGreaterThan(4.5);
  await v.page.keyboard.press("j");
  await expect.poll(() => mediaTime(v.page)).toBeLessThan(1);
  await v.page.keyboard.press("k");
  await expect(v.page.getByRole("button", { name: "Pause, keyboard shortcut K" })).toBeVisible();
  await v.page.keyboard.press("k");
  await expect(v.page.getByRole("button", { name: /^Play, keyboard shortcut K/ }).first()).toBeVisible();
  await v.page.goto(`/v/${id}?t=3`);
  await expect.poll(() => mediaTime(v.page)).toBeGreaterThan(2.9);
  await v.ctx.close();
});

test("R9 viewers comment with their name at the current time; timestamps seek; only own comments can be deleted", async ({ browser }) => {
  const a = await viewer(browser), b = await viewer(browser);
  await a.page.goto(`/v/${id}?t=2`);
  await expect.poll(() => mediaTime(a.page)).toBeGreaterThan(1.9);
  await a.page.getByLabel("Your name").fill("Asha Kumar");
  await a.page.getByLabel("Comment", { exact: true }).fill("Love the new flow 🙌");
  await expect(a.page.getByText("at 0:02")).toBeVisible();
  await a.page.getByRole("button", { name: "Post" }).click();
  const c = a.page.getByTestId("comment").filter({ hasText: "Love the new flow" });
  await expect(c).toContainText("Asha Kumar");
  await expect(c.getByRole("button", { name: "Jump to 0:02" })).toBeVisible();
  await a.page.getByLabel("Comment", { exact: true }).fill("General note, no time");
  await a.page.getByRole("checkbox", { name: /at 0:0/ }).uncheck();
  await a.page.getByRole("button", { name: "Post" }).click();
  await expect(a.page.getByTestId("comment").filter({ hasText: "General note" }).getByRole("button", { name: /Jump to/ })).toHaveCount(0);
  // The name is remembered for next time.
  await a.page.reload();
  await expect(a.page.getByLabel("Your name")).toHaveValue("Asha Kumar");
  // Another viewer sees the comment, jumps to it, and can't delete it.
  await b.page.goto(`/v/${id}`);
  const bc = b.page.getByTestId("comment").filter({ hasText: "Love the new flow" });
  await expect(bc).toBeVisible();
  await expect(bc.getByRole("button", { name: "Delete comment" })).toHaveCount(0);
  await bc.getByRole("button", { name: "Jump to 0:02" }).click();
  await expect.poll(() => mediaTime(b.page)).toBeGreaterThan(1.9);
  const cid = (await (await a.page.request.get(`/api/videos/${id}/comments`)).json()).comments[0].id;
  expect((await b.page.request.delete(`/api/videos/${id}/comments/${cid}`, { headers: { origin: new URL(b.page.url()).origin } })).status()).toBe(403);
  // A marker sits on the seek bar.
  await expect(b.page.locator(".m-comment")).toHaveCount(1);
  await a.page.getByTestId("comment").filter({ hasText: "General note" }).hover();
  await a.page.getByTestId("comment").filter({ hasText: "General note" }).getByRole("button", { name: "Delete comment" }).click();
  await expect(a.page.getByTestId("comment").filter({ hasText: "General note" })).toHaveCount(0);
  await a.ctx.close(); await b.ctx.close();
});

test("R10 emoji reactions float over the player, count up, and leave a marker at their time", async ({ browser }) => {
  const v = await viewer(browser);
  await v.page.goto(`/v/${id}?t=4`);
  await expect.poll(() => mediaTime(v.page)).toBeGreaterThan(3.9);
  await v.page.getByRole("button", { name: "React 🔥" }).click();
  await expect(v.page.locator(".bursts span")).toHaveCount(1);
  await expect(v.page.getByRole("button", { name: "React 🔥" })).toContainText("1");
  await expect(v.page.locator(".m-reaction", { hasText: "🔥" })).toHaveCount(1);
  const meta = (await (await v.page.request.get(`/api/videos/${id}`)).json()).video;
  expect(meta.reactions.find((r: any) => r.emoji === "🔥").timeMs).toBeGreaterThanOrEqual(3900);
  const bad = await v.page.request.post(`/api/videos/${id}/reactions`, { data: { emoji: "💩", timeMs: 0 }, headers: { origin: new URL(v.page.url()).origin, "x-viewer": "A".repeat(22) } });
  expect(bad.status()).toBe(400);
  await v.ctx.close();
});

test("R6 unknown video ids show the not-found page", async ({ page }) => {
  await page.goto("/v/AAAAAAAAAAAA");
  await expect(page.getByRole("heading", { name: "Video not found" })).toBeVisible();
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
