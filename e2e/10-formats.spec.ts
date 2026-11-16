import { test, expect } from "@playwright/test";
import { signIn, record, origin } from "./helpers";

test.beforeEach(async ({ page }) => { await signIn(page); });

// A WebM shaped like files saved before 0.1.1: Segment and first Cluster with known sizes that run
// to the end of the file, so the second Cluster sits inside the first.
function nestedWebm(): { bytes: Buffer; segSizeAt: number; clusterSizeAt: number } {
  const size4 = (n: number) => Buffer.from([0x10 | (n >>> 24), (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const el = (id: number[], body: Buffer) => Buffer.concat([Buffer.from(id), size4(body.length), body]);
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], Buffer.from([0x42, 0x82, 0x84, ...Buffer.from("webm")]));
  const info = el([0x15, 0x49, 0xa9, 0x66], Buffer.from([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]));
  const block = (n: number) => Buffer.concat([Buffer.from([0xa3]), size4(n), Buffer.alloc(n, 7)]);
  const inner = Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), Buffer.from([0xe7, 0x81, 0x01]), block(9000)]);
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([Buffer.from([0xe7, 0x81, 0x00]), block(200), inner]));
  const segment = el([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, cluster]));
  const bytes = Buffer.concat([ebml, segment]);
  return { bytes, segSizeAt: ebml.length + 4, clusterSizeAt: ebml.length + 8 + info.length + 4 };
}

test("R6a WebM saved by 0.1.0 is served with its sizes repaired; the stored file is untouched", async ({ page }) => {
  const { bytes, segSizeAt, clusterSizeAt } = nestedWebm();
  const o = origin(page);
  const { id } = await (await page.request.post("/api/videos", { data: { contentType: "video/webm", mode: "screen", width: 640, height: 360, title: "Old WebM" }, headers: o })).json();
  const part = await (await page.request.put(`/api/videos/${id}/parts/1`, { data: bytes, headers: { ...o, "content-type": "application/octet-stream" } })).json();
  expect((await page.request.post(`/api/videos/${id}/complete`, { data: { parts: [part], durationMs: 1000 }, headers: o })).status()).toBe(200);
  const fullRes = await page.request.get(`/api/videos/${id}/media`);
  expect(fullRes.headers()["content-length"]).toBe(String(bytes.length));
  const full = await fullRes.body();
  expect(full.length).toBe(bytes.length);
  expect(full.subarray(segSizeAt, segSizeAt + 4).toString("hex")).toBe("1fffffff");
  expect(full.subarray(clusterSizeAt, clusterSizeAt + 4).toString("hex")).toBe("1fffffff");
  // Everything else is byte-for-byte the stored file.
  const restore = Buffer.from(full); bytes.copy(restore, segSizeAt, segSizeAt, segSizeAt + 4); bytes.copy(restore, clusterSizeAt, clusterSizeAt, clusterSizeAt + 4);
  expect(restore.equals(bytes)).toBe(true);
  const r1 = await page.request.get(`/api/videos/${id}/media`, { headers: { range: `bytes=${segSizeAt}-${segSizeAt + 3}` } });
  expect(r1.status()).toBe(206);
  expect((await r1.body()).toString("hex")).toBe("1fffffff");
  expect(r1.headers()["content-length"]).toBe("4");
  expect(r1.headers()["content-range"]).toBe(`bytes ${segSizeAt}-${segSizeAt + 3}/${bytes.length}`);
  const r2 = await page.request.get(`/api/videos/${id}/media`, { headers: { range: "bytes=5000-5099" } });
  expect((await r2.body()).equals(bytes.subarray(5000, 5100))).toBe(true);
  expect(r2.headers()["accept-ranges"]).toBe("bytes");
  await page.request.delete(`/api/videos/${id}`, { headers: o });
});

test("R6a a browser that can't play the format gets a clear notice with a download", async ({ page }) => {
  const id = await record(page, { mode: "Camera only", ms: 1500 });
  await page.route(`**/api/videos/${id}/media`, r => r.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.alloc(4000, 1) }));
  await page.goto(`/v/${id}`);
  await expect(page.getByTestId("format-notice")).toContainText("This browser can't play this recording");
  await expect(page.getByTestId("format-notice").getByRole("link", { name: "Download" })).toHaveAttribute("href", `/api/videos/${id}/media?download`);
});
