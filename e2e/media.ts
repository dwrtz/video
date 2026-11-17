// Inspects video files from the tests with ffprobe/ffmpeg (both must be on PATH).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

function withFile<T>(buf: Buffer, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "av-")); const p = join(dir, "v.bin");
  writeFileSync(p, buf);
  try { return fn(p); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Container duration (s), whether there is an audio / video stream, and the codecs. */
export function probe(buf: Buffer) {
  return withFile(buf, p => {
    const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", p]).toString());
    const streams = j.streams as { codec_type: string; codec_name: string }[];
    // Count the decoded length too: a container can claim a length its packets don't have.
    const frames = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", p]).toString().trim().split("\n").map(Number).filter(n => !isNaN(n));
    return {
      duration: Number(j.format.duration), format: j.format.format_name as string,
      hasAudio: streams.some(s => s.codec_type === "audio"), hasVideo: streams.some(s => s.codec_type === "video"),
      codecs: streams.map(s => s.codec_name), videoSpan: frames.length ? Math.max(...frames) - Math.min(...frames) : 0,
    };
  });
}

/**
 * Reads the timecode drawn by {@link timecodeScreen} from every frame: 12 black/white bars across the top half
 * give the time since the fake screen started, in tenths of a second.
 */
export function timecodes(buf: Buffer): number[] {
  return withFile(buf, p => {
    const W = 120, H = 68;
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", p, "-vf", `scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 });
    const out: number[] = [];
    for (let f = 0; f + W * H <= raw.length; f += W * H) {
      let n = 0;
      for (let b = 0; b < 12; b++) n = (n << 1) | (raw[f + 17 * W + b * 10 + 5] > 128 ? 1 : 0);
      out.push(n);
    }
    return out;
  });
}
/** Jumps between consecutive frames' timecodes larger than `minTenths`. */
export const jumps = (codes: number[], minTenths = 4) => codes.slice(1).map((c, i) => c - codes[i]).filter(d => d > minTenths);

/** Replaces the screen picker with a 640×360 canvas whose top half encodes the elapsed time (see {@link timecodes}). */
export async function timecodeScreen(page: Page) {
  await page.addInitScript(() => {
    (MediaDevices.prototype as any).getDisplayMedia = async function () {
      const c = document.createElement("canvas"); c.width = 640; c.height = 360;
      const g = c.getContext("2d")!; const t0 = performance.now();
      const draw = () => {
        const n = Math.min(4095, Math.floor((performance.now() - t0) / 100));
        g.fillStyle = "#808080"; g.fillRect(0, 180, 640, 180);
        for (let b = 0; b < 12; b++) { g.fillStyle = (n >> (11 - b)) & 1 ? "#fff" : "#000"; g.fillRect(Math.round(b * 640 / 12), 0, Math.ceil(640 / 12), 180); }
      };
      draw(); setInterval(draw, 20);
      const s = c.captureStream(30);
      (s.getVideoTracks()[0] as any).getSettings = () => ({ width: 640, height: 360, frameRate: 30, displaySurface: "browser" });
      return s;
    };
  });
}

/** The stored file of a video, as its owner downloads it. */
export const fileOf = async (page: Page, id: string) => Buffer.from(await (await page.request.get(`/api/videos/${id}/media?download`)).body());
