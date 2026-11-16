import { test, expect } from "@playwright/test";
import { PASSWORD, signIn } from "./helpers";

test("R2 an email that isn't on the allowlist is refused at sign-up and sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Mallory");
  await page.getByLabel("Email").fill("mallory@example.org");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("This site only accepts accounts for approved email addresses.")).toBeVisible();
  const o = { origin: new URL(page.url()).origin };
  const up = await page.request.post("/api/auth/signup", { data: { email: "MALLORY@example.org", name: "M", password: PASSWORD }, headers: o });
  expect(up.status()).toBe(403);
  expect((await up.json()).error).toBe("This site only accepts accounts for approved email addresses.");
  const inn = await page.request.post("/api/auth/signin", { data: { email: "mallory@example.org", password: PASSWORD }, headers: o });
  expect(inn.status()).toBe(403);
  expect((await page.request.get("/api/me")).ok()).toBe(true);
  expect((await (await page.request.get("/api/me")).json()).user).toBeNull();
});

test("R2 allowlisted owner signs up, signs out and signs back in; wrong password is refused", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Dana Owner");
  await page.getByLabel("Email").fill("Owner@Example.com");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 8 characters")).toBeVisible();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // The account may already exist when this file is re-run against the same server.
  const exists = page.getByText("Already registered. Sign in instead.");
  if (await exists.isVisible().catch(() => false)) { await signIn(page); }
  await expect(page.getByRole("heading", { name: "My videos" })).toBeVisible();
  const cookies = await page.context().cookies();
  const sid = cookies.find(c => c.name === "sid")!;
  expect(sid.httpOnly).toBe(true);
  expect(sid.sameSite).toBe("Lax");
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("wrong password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is wrong")).toBeVisible();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "My videos" })).toBeVisible();
});

test("R2 signed-out visitors can't reach the recorder or the library API", async ({ page }) => {
  await page.goto("/record");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect((await page.request.get("/api/videos")).status()).toBe(401);
});
