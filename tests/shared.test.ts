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
