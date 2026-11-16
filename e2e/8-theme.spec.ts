import { test, expect } from "@playwright/test";

test("R14 the theme follows the system and the toggle cycles system → light → dark, remembered across reloads", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  expect(await theme()).toBe("dark");
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".auth-main")!).backgroundColor);
  expect(bg).toBe("rgb(21, 24, 30)");
  await page.getByRole("button", { name: /^Theme: system/ }).click();
  expect(await theme()).toBe("light");
  await page.getByRole("button", { name: /^Theme: light/ }).click();
  expect(await theme()).toBe("dark");
  await page.reload();
  expect(await theme()).toBe("dark");
  await expect(page.getByRole("button", { name: /^Theme: dark/ })).toBeVisible();
  await ctx.close();
});

test("R1 the page title and accent colour come from spekkr.inputs.json", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page).toHaveTitle("Async Video");
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  expect(accent).toBe("#0d9488");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".auth-card .btn-primary")!).backgroundColor)).toBe("rgb(13, 148, 136)");
});
