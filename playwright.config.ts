import { defineConfig, devices } from "@playwright/test";
const PORT = 3220;
// The real Worker under `wrangler dev`, with a fresh local D1 and R2 in .e2e/.
// Only owner@example.com and second@example.com may have accounts, so the allowlist is tested too.
const serve = [
  "rm -rf .e2e",
  "npm run build",
  "npx wrangler d1 migrations apply DB --local --persist-to .e2e",
  `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to .e2e --var ALLOWED_EMAILS:owner@example.com,second@example.com --show-interactive-dev-session=false`,
].join(" && ");
// Fake camera, microphone and screen: Chromium's test pattern devices, granted without prompts.
export const mediaArgs = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--autoplay-policy=no-user-gesture-required"];
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`, viewport: { width: 1360, height: 900 }, launchOptions: { args: mediaArgs }, permissions: ["camera", "microphone"] },
  projects: [
    { name: "desktop", testIgnore: /mobile/ },
    { name: "iphone-13", testMatch: /mobile/, use: { ...devices["iPhone 13"], browserName: "chromium", launchOptions: { args: mediaArgs } } },
    { name: "pixel-7", testMatch: /mobile/, use: { ...devices["Pixel 7"], launchOptions: { args: mediaArgs } } },
  ],
  webServer: process.env.BASE_URL ? undefined : { command: serve, url: `http://127.0.0.1:${PORT}/api/health`, reuseExistingServer: false, timeout: 180_000 },
});
