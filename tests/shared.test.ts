import { describe, expect, it } from "vitest";
import { formatTime, parseTime, parseChapters, chapterAt, trimWindow, validTrim, atSpeed, chaptersToText } from "../src/shared/time";
import { parseAllowlist, emailAllowed } from "../src/shared/allowlist";
import { parseRange } from "../src/shared/range";
import { planParts } from "../src/shared/parts";
import { randomId, isVideoId, isViewerId } from "../src/shared/ids";
import { clampBubble, BUBBLE_DIAMETER, MARGIN } from "../src/client/lib/recorder";
import { LIMITS, REACTIONS, SPEEDS } from "../src/shared/limits";

describe("time formatting", () => {
  it("formats and parses", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(75_400)).toBe("1:15");
    expect(formatTime(3_725_000)).toBe("1:02:05");
    expect(formatTime(-5)).toBe("0:00");
    expect(parseTime("1:15")).toBe(75_000);
    expect(parseTime("01:02:05")).toBe(3_725_000);
    expect(parseTime("75")).toBe(75_000);
    expect(parseTime("1:75")).toBeNull();
    expect(parseTime("abc")).toBeNull();
  });
});

describe("chapters", () => {
  it("parses, sorts and round-trips", () => {
    const r = parseChapters("1:00 Demo\n0:00 Intro\n\n2:30   Wrap up", 200_000);
    expect(r).toEqual({ chapters: [{ timeMs: 0, title: "Intro" }, { timeMs: 60_000, title: "Demo" }, { timeMs: 150_000, title: "Wrap up" }] });
    if ("chapters" in r) expect(chaptersToText(r.chapters)).toBe("0:00 Intro\n1:00 Demo\n2:30 Wrap up");
  });
  it("rejects bad lines, times past the end and duplicates", () => {
    expect(parseChapters("Intro", 10_000)).toEqual({ error: "Line 1: start with a time like 1:05, then a title" });
    expect(parseChapters("0:20 Late", 10_000)).toEqual({ error: "Line 1: 0:20 is past the end of the video" });
    expect(parseChapters("0:01 A\n0:01 B", 10_000)).toEqual({ error: "Two chapters start at 0:01" });
  });
  it("finds the chapter playing", () => {
    const c = [{ timeMs: 0, title: "a" }, { timeMs: 5000, title: "b" }];
    expect(chapterAt(c, 4999)).toBe(0);
    expect(chapterAt(c, 5000)).toBe(1);
    expect(chapterAt([{ timeMs: 2000, title: "x" }], 1000)).toBe(-1);
  });
});

describe("trim", () => {
  it("computes the window and validates", () => {
    expect(trimWindow({ durationMs: 10_000, trimStartMs: 1000, trimEndMs: null })).toEqual({ start: 1000, end: 10_000, length: 9000 });
    expect(trimWindow({ durationMs: 10_000, trimStartMs: 1000, trimEndMs: 4000 }).length).toBe(3000);
    expect(validTrim(10_000, 0, null)).toBeNull();
    expect(validTrim(10_000, 2000, 2500)).toBe("Keep at least one second");
    expect(validTrim(10_000, 0, 11_000)).toBe("Trim end is past the end of the video");
    expect(validTrim(10_000, -1, null)).toBe("Trim start must be 0 or more");
  });
  it("shows the length at each speed", () => {
    expect(atSpeed(120_000, 2)).toBe(60_000);
    expect(atSpeed(100_000, 1.5)).toBe(66_667);
    expect(SPEEDS).toContain(1);
  });
});

describe("allowlist", () => {
  it("is case-insensitive and empty means anyone", () => {
    const list = parseAllowlist(" Owner@Example.com , second@example.com,");
    expect(list).toEqual(["owner@example.com", "second@example.com"]);
    expect(emailAllowed(list, "OWNER@example.com ")).toBe(true);
    expect(emailAllowed(list, "other@example.com")).toBe(false);
    expect(emailAllowed(list, undefined)).toBe(false);
    expect(emailAllowed(parseAllowlist(""), "anyone@x.io")).toBe(true);
  });
});

describe("byte ranges", () => {
  it("parses single ranges", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ offset: 0, length: 10 });
    expect(parseRange("bytes=90-", 100)).toEqual({ offset: 90, length: 10 });
    expect(parseRange("bytes=-20", 100)).toEqual({ offset: 80, length: 20 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ offset: 50, length: 50 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});

describe("multipart plan", () => {
  it("splits into 5 MiB parts with a smaller last part", () => {
    const P = LIMITS.partBytes;
    expect(planParts(0, P)).toEqual([]);
    expect(planParts(10, P)).toEqual([{ partNumber: 1, start: 0, end: 10 }]);
    const plan = planParts(2 * P + 7, P);
    expect(plan.map(p => p.partNumber)).toEqual([1, 2, 3]);
    expect(plan[2]).toEqual({ partNumber: 3, start: 2 * P, end: 2 * P + 7 });
  });
});

describe("ids and constants", () => {
  it("makes 12-char base62 video ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isVideoId(id)).toBe(true);
    expect(isVideoId("short")).toBe(false);
    expect(isViewerId(randomId(22))).toBe(true);
    expect(REACTIONS).toHaveLength(6);
  });
});

describe("camera bubble", () => {
  it("stays inside the frame with a margin", () => {
    const w = 1920, h = 1080, r = (BUBBLE_DIAMETER.md * h) / 2, m = MARGIN * h;
    const c = clampBubble({ x: 0, y: 1, size: "md" }, w, h);
    expect(c.x * w).toBeCloseTo(r + m);
    expect(c.y * h).toBeCloseTo(h - r - m);
    const mid = clampBubble({ x: 0.5, y: 0.5, size: "lg" }, w, h);
    expect(mid).toEqual({ x: 0.5, y: 0.5, size: "lg" });
  });
});

import { segments, keptLength, toKept, toMedia, nextPlayable, validCut } from "../src/shared/time";
import { webmHeaderPatches, applyPatches, unknownSize } from "../src/shared/webm";
import { pickMimeType } from "../src/client/lib/recorder";

describe("removed section", () => {
  const v = { durationMs: 10_000, trimStartMs: 1000, trimEndMs: 9000, cutStartMs: 3000, cutEndMs: 5000 };
  it("splits the kept part around the removed section", () => {
    expect(segments(v)).toEqual([[1000, 3000], [5000, 9000]]);
    expect(keptLength(v)).toBe(6000);
    expect(segments({ ...v, cutStartMs: null, cutEndMs: null })).toEqual([[1000, 9000]]);
  });
  it("maps between media time and the viewer's timeline", () => {
    expect(toKept(v, 1000)).toBe(0);
    expect(toKept(v, 2500)).toBe(1500);
    expect(toKept(v, 4000)).toBe(2000); // inside the removed part → its edge
    expect(toKept(v, 6000)).toBe(3000);
    expect(toMedia(v, 1500)).toBe(2500);
    expect(toMedia(v, 2500)).toBe(5500);
    expect(toMedia(v, 99_999)).toBe(9000);
  });
  it("jumps over the removed part and stops at the end", () => {
    expect(nextPlayable(v, 500)).toBe(1000);
    expect(nextPlayable(v, 2000)).toBe(2000);
    expect(nextPlayable(v, 3000)).toBe(5000);
    expect(nextPlayable(v, 9000)).toBeNull();
  });
  it("validates", () => {
    expect(validCut(v)).toBeNull();
    expect(validCut({ ...v, cutStartMs: 500 })).toMatch(/inside the kept part/);
    expect(validCut({ ...v, cutEndMs: 3200 })).toMatch(/half a second/);
    expect(validCut({ ...v, cutStartMs: 1100, cutEndMs: 8500 })).toMatch(/at least one second/);
    expect(validCut({ ...v, cutEndMs: null })).toMatch(/start and an end/);
  });
});

describe("webm repair", () => {
  const size4 = (n: number) => [0x10 | (n >>> 24), (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const el = (id: number[], body: number[]) => [...id, ...size4(body.length), ...body];
  const build = (known: boolean) => {
    const ebml = el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, 119, 101, 98, 109]);
    const info = el([0x15, 0x49, 0xa9, 0x66], [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
    const inner = [0x1f, 0x43, 0xb6, 0x75, 0x01, 255, 255, 255, 255, 255, 255, 255, 0xe7, 0x81, 1];
    const cl = el([0x1f, 0x43, 0xb6, 0x75], [0xe7, 0x81, 0, ...inner]);
    const seg = el([0x18, 0x53, 0x80, 0x67], [...info, ...cl]);
    const bytes = new Uint8Array([...ebml, ...seg]);
    if (!known) { bytes.set(unknownSize(4), ebml.length + 4); bytes.set(unknownSize(4), ebml.length + 8 + info.length + 4); }
    return { bytes, segAt: ebml.length + 4, clAt: ebml.length + 8 + info.length + 4 };
  };
  it("marks a Segment and first Cluster that swallow the rest of the file as unknown-size", () => {
    const { bytes, segAt, clAt } = build(true);
    const p = webmHeaderPatches(bytes, bytes.length);
    expect(p.map(x => x.offset)).toEqual([segAt, clAt]);
    const fixed = applyPatches(bytes, 0, p);
    expect(fixed).toEqual(build(false).bytes);
    expect(webmHeaderPatches(fixed, fixed.length)).toEqual([]);
    expect(bytes[segAt]).toBe(0x10); // input untouched
  });
  it("patches chunks at any offset and leaves other files alone", () => {
    const { bytes, clAt } = build(true);
    const p = webmHeaderPatches(bytes, bytes.length);
    expect(Array.from(applyPatches(bytes.subarray(clAt + 2), clAt + 2, p).subarray(0, 2))).toEqual([255, 255]);
    expect(webmHeaderPatches(bytes, bytes.length + 10)).toEqual([]); // sizes don't reach the end: not the broken shape
    expect(webmHeaderPatches(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), 8)).toEqual([]); // MP4
    expect(Array.from(unknownSize(1))).toEqual([0xff]);
    expect(Array.from(unknownSize(8))).toEqual([1, 255, 255, 255, 255, 255, 255, 255]);
  });
});

describe("recording format", () => {
  it("prefers MP4 (H.264) and falls back to WebM", () => {
    expect(pickMimeType(() => true)).toBe("video/mp4;codecs=avc1.42E01F,mp4a.40.2");
    expect(pickMimeType(t => t === "video/mp4;codecs=avc1,opus" || t.startsWith("video/webm"))).toBe("video/mp4;codecs=avc1,opus");
    expect(pickMimeType(t => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
    expect(pickMimeType(() => false)).toBe("");
  });
});
