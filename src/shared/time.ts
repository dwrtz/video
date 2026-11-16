import { LIMITS } from "./limits";
export type Chapter = { timeMs: number; title: string };

/** 0 → "0:00", 75_400 → "1:15", 3_725_000 → "1:02:05". Seconds are floored. */
export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "1:15" / "01:02:05" / "75" → milliseconds, or null. */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.slice(1).some(p => p > 59)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
}

/** Chapters text: one "m:ss Title" per line. Returns sorted chapters or the first error. */
export function parseChapters(text: string, durationMs: number): { chapters: Chapter[] } | { error: string } {
  const out: Chapter[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const m = /^(\S+)\s+(.+)$/.exec(line);
    const timeMs = m ? parseTime(m[1]) : null;
    if (!m || timeMs === null) return { error: `Line ${i + 1}: start with a time like 1:05, then a title` };
    if (durationMs && timeMs >= durationMs) return { error: `Line ${i + 1}: ${m[1]} is past the end of the video` };
    out.push({ timeMs, title: m[2].slice(0, LIMITS.chapterTitleChars) });
  }
  if (out.length > LIMITS.chapters) return { error: `At most ${LIMITS.chapters} chapters` };
  out.sort((a, b) => a.timeMs - b.timeMs);
  for (let i = 1; i < out.length; i++) if (out[i].timeMs === out[i - 1].timeMs) return { error: `Two chapters start at ${formatTime(out[i].timeMs)}` };
  return { chapters: out };
}
export const chaptersToText = (c: Chapter[]) => c.map(x => `${formatTime(x.timeMs)} ${x.title}`).join("\n");

/** The chapter playing at media time t (chapters are sorted). */
export function chapterAt(chapters: Chapter[], t: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].timeMs <= t) idx = i;
  return idx;
}

/** Trim window [start, end] in media time. */
export function trimWindow(v: { durationMs: number; trimStartMs: number; trimEndMs: number | null }) {
  const end = v.trimEndMs ?? v.durationMs;
  return { start: v.trimStartMs, end, length: Math.max(0, end - v.trimStartMs) };
}
export function validTrim(durationMs: number, start: number, end: number | null): string | null {
  const e = end ?? durationMs;
  if (!Number.isInteger(start) || start < 0) return "Trim start must be 0 or more";
  if (!Number.isInteger(e) || e > durationMs) return "Trim end is past the end of the video";
  if (e - start < 1000) return "Keep at least one second";
  return null;
}

/** How long the (trimmed) video takes at a speed, for the speed menu. */
export const atSpeed = (lengthMs: number, speed: number) => Math.round(lengthMs / speed);
