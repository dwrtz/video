import { test, expect } from "@playwright/test";
import { signIn, origin } from "./helpers";

test("R16 cross-site writes are refused and inputs are checked", async ({ page }) => {
  await signIn(page);
  expect((await page.request.post("/api/videos", { data: { contentType: "video/webm", mode: "screen", width: 10, height: 10 }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
  expect((await page.request.post("/api/videos", { data: { contentType: "video/webm", mode: "screen", width: 10, height: 10 } })).status()).toBe(403);
  const bad = await page.request.post("/api/videos", { data: { contentType: "image/gif", mode: "screen", width: 10, height: 10 }, headers: origin(page) });
  expect(bad.status()).toBe(400);
  expect((await page.request.post("/api/videos", { data: { contentType: "video/webm", mode: "drone", width: 10, height: 10 }, headers: origin(page) })).status()).toBe(400);
  expect((await page.request.get("/api/videos/not-an-id")).status()).toBe(404);
  // An unfinished upload isn't visible to anyone, and can be aborted.
  const r = await page.request.post("/api/videos", { data: { contentType: "video/webm", mode: "screen", width: 1280, height: 720, title: "x" }, headers: origin(page) });
  expect(r.status()).toBe(201);
  const { id } = await r.json();
  expect((await page.request.get(`/api/videos/${id}`)).status()).toBe(404);
  expect((await page.request.put(`/api/videos/${id}/parts/1`, { data: Buffer.alloc(11 * 1024 * 1024), headers: origin(page) })).status()).toBe(413);
  expect((await page.request.post(`/api/videos/${id}/complete`, { data: { parts: [], durationMs: 1000 }, headers: origin(page) })).status()).toBe(400);
  expect((await page.request.delete(`/api/videos/${id}/upload`, { headers: origin(page) })).status()).toBe(200);
});

test("R16 creating videos is rate limited per account (10 a minute)", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, "second@example.com", "Sam Second");
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await page.request.post("/api/videos", { data: { contentType: "video/webm", mode: "screen", width: 1280, height: 720, title: `burst ${i}` }, headers: origin(page) });
    codes.push(r.status());
    if (r.status() === 201) await page.request.delete(`/api/videos/${(await r.json()).id}/upload`, { headers: origin(page) });
  }
  expect(codes.filter(c => c === 201).length).toBe(10);
  expect(codes.slice(10)).toEqual([429, 429]);
  await ctx.close();
});
