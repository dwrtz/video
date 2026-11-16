import { test, expect } from "@playwright/test";
import { signIn, record, origin } from "./helpers";

test("R12 the library lists my videos newest first, searches, renames and deletes from the card menu", async ({ page }) => {
  await signIn(page);
  const id = await record(page, { mode: "Screen only", ms: 1500 });
  await page.request.patch(`/api/videos/${id}`, { data: { title: "Library search target" }, headers: origin(page) });
  await page.goto("/");
  const cards = page.getByTestId("video-card");
  await expect(cards.first()).toContainText("Library search target");
  await expect(cards.first().locator(".duration")).toHaveText(/^0:0[12]$/);
  await expect(cards.first().locator("img")).toHaveAttribute("src", `/api/videos/${id}/thumbnail`);
  await page.getByRole("searchbox", { name: "Search videos" }).fill("search TARGET");
  await expect(cards).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search videos" }).fill("zzz no match");
  await expect(page.getByText("No videos match")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search videos" }).fill("");
  await page.getByRole("button", { name: "More actions for Library search target" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Video title" }).fill("Renamed from library");
  await page.keyboard.press("Enter");
  await expect(cards.first()).toContainText("Renamed from library");
  await page.getByRole("button", { name: "More actions for Renamed from library" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Renamed from library")).toHaveCount(0);
});

test("R12 R13 another account sees none of my videos and can't change them", async ({ page, browser }) => {
  await signIn(page);
  const id = await record(page, { mode: "Screen only", ms: 1500 });
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, "second@example.com", "Sam Second");
  const list = (await (await other.request.get("/api/videos")).json()).videos;
  expect(list.find((v: any) => v.id === id)).toBeUndefined();
  expect((await other.request.patch(`/api/videos/${id}`, { data: { title: "hijack" }, headers: origin(other) })).status()).toBe(403);
  expect((await other.request.delete(`/api/videos/${id}`, { headers: origin(other) })).status()).toBe(403);
  await other.goto(`/v/${id}`);
  await expect(other.getByRole("button", { name: "Edit video" })).toHaveCount(0);
  await ctx.close();
});
