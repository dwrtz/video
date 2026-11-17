import { HttpError, Router, json, body } from "./http";
import { checkOrigin, checkPassword, clientIp, hashPassword, limit, randomToken, sha256 } from "./security";
import { parseAllowlist, emailAllowed, NOT_ALLOWED } from "../shared/allowlist";
import { LIMITS, MODES, REACTIONS, type Mode } from "../shared/limits";
import { randomId, isVideoId, isViewerId } from "../shared/ids";
import { parseRange } from "../shared/range";
import { remapChapters, remapTime, validSpans, type Chapter } from "../shared/time";
import { applyPatches, webmHeaderPatches } from "../shared/webm";
import type { Me, VideoDetail, VideoSummary, Comment } from "../shared/types";

const now = () => Date.now();
const videoKey = (id: string) => `videos/${id}/video`;
const thumbKey = (id: string) => `videos/${id}/thumb.jpg`;
/** The current file: a video's first upload lives at videos/{id}/video; each cut replaces it with videos/{id}/v-{random}. */
const mediaKey = (v: Row) => (v.media_key as string | null) ?? videoKey(v.id);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTENT_TYPES = ["video/webm", "video/mp4"];

// ---------- accounts ----------
function cookieFor(req: Request, token: string, maxAge: number) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
const sid = (req: Request) => /(?:^|;\s*)sid=([A-Za-z0-9_-]{43})/.exec(req.headers.get("cookie") ?? "")?.[1];

async function currentUser(req: Request, env: Env): Promise<Me | null> {
  const token = sid(req);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(await sha256(token), now()).first<Me>();
  if (!row) return null;
  // An account whose email is no longer on the allowlist can't use its session.
  if (!emailAllowed(parseAllowlist(env.ALLOWED_EMAILS), row.email)) return null;
  return row;
}
async function requireUser(req: Request, env: Env) {
  const u = await currentUser(req, env);
  if (!u) throw new HttpError(401, "Sign in first");
  return u;
}
async function startSession(req: Request, env: Env, user: Me) {
  const token = randomToken();
  const days = LIMITS.sessionDays;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), user.id, now() + days * 864e5).run();
  return json({ user }, 200, { "set-cookie": cookieFor(req, token, days * 86400) });
}

// ---------- videos ----------
type Row = Record<string, any>;
const summary = (r: Row): VideoSummary => ({
  id: r.id, title: r.title, status: r.status, mode: r.mode, durationMs: r.duration_ms,
  createdAt: r.created_at, viewCount: r.view_count, commentCount: r.comment_count ?? 0, hasThumbnail: !!r.has_thumbnail, size: r.size,
});
async function getVideo(env: Env, id: string): Promise<Row> {
  if (!isVideoId(id)) throw new HttpError(404, "Video not found");
  const r = await env.DB.prepare("SELECT v.*, u.name AS owner_name FROM videos v JOIN users u ON u.id = v.owner_id WHERE v.id = ?").bind(id).first<Row>();
  if (!r) throw new HttpError(404, "Video not found");
  return r;
}
async function ownVideo(req: Request, env: Env, id: string) {
  const user = await requireUser(req, env);
  const v = await getVideo(env, id);
  if (v.owner_id !== user.id) throw new HttpError(403, "Only the owner can do that");
  return { user, v };
}
async function readyVideo(env: Env, id: string) {
  const v = await getVideo(env, id);
  if (v.status !== "ready") throw new HttpError(404, "Video not found");
  return v;
}
const viewerOf = (req: Request) => { const v = req.headers.get("x-viewer"); return isViewerId(v) ? v : null; };

/**
 * WebM files saved before 0.1.1 went through a duration fix that nested every Cluster inside the first
 * one (see src/shared/webm.ts). Strict players (Safari on iPhone) refuse those. The stored file is never
 * changed: the two size fields are corrected in the bytes on their way out, for any range that covers them.
 */
// The patched stream keeps its exact length (patches never change sizes), so it goes through a
// FixedLengthStream: Workers then still send Content-Length, which Safari wants on 206 answers.
async function repairWebm(env: Env, v: Row, size: number, start: number, length: number, body: ReadableStream): Promise<ReadableStream> {
  if (!String(v.content_type).startsWith("video/webm") || start >= 4096) return body;
  const head = await env.MEDIA.get(mediaKey(v), { range: { offset: 0, length: Math.min(4096, size) } });
  if (!head) return body;
  const patches = webmHeaderPatches(new Uint8Array(await head.arrayBuffer()), size);
  if (!patches.length) return body;
  let pos = start;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) { ctl.enqueue(applyPatches(chunk, pos, patches)); pos += chunk.length; },
  })).pipeThrough(new FixedLengthStream(length));
}

async function deleteVideoData(env: Env, v: Row) {
  if (v.status === "uploading" && v.upload_id) await env.MEDIA.resumeMultipartUpload(videoKey(v.id), v.upload_id).abort().catch(() => {});
  if (v.pending_key && v.pending_upload_id) await env.MEDIA.resumeMultipartUpload(v.pending_key, v.pending_upload_id).abort().catch(() => {});
  await env.MEDIA.delete([...new Set([videoKey(v.id), mediaKey(v), thumbKey(v.id)])]);
  await env.DB.batch(["comments", "reactions", "views"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE video_id = ?`).bind(v.id))
    .concat(env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(v.id)));
}

function title(raw: unknown, fallback?: string) {
  const t = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!t) { if (fallback !== undefined) return fallback; throw new HttpError(400, "Give the video a title", { title: "Required" }); }
  return t.slice(0, LIMITS.titleChars);
}
function cleanChapters(raw: unknown, durationMs: number): Chapter[] {
  if (!Array.isArray(raw) || raw.length > LIMITS.chapters) throw new HttpError(400, "Chapters must be a list of at most 50");
  const out = raw.map((c: any) => {
    const t = typeof c?.title === "string" ? c.title.trim().slice(0, LIMITS.chapterTitleChars) : "";
    if (!Number.isInteger(c?.timeMs) || c.timeMs < 0 || c.timeMs >= durationMs || !t) throw new HttpError(400, "Each chapter needs a time inside the video and a title");
    return { timeMs: c.timeMs as number, title: t };
  }).sort((a, b) => a.timeMs - b.timeMs);
  for (let i = 1; i < out.length; i++) if (out[i].timeMs === out[i - 1].timeMs) throw new HttpError(400, "Two chapters start at the same time");
  return out;
}

const router = new Router()
  .on("GET", "/api/health", async () => json({ ok: true }))

  // Accounts
  .on("POST", "/api/auth/signup", async (req, env) => {
    const b = await body(req);
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    const name = typeof b.name === "string" ? b.name.trim().slice(0, LIMITS.nameChars) : "";
    const password = typeof b.password === "string" ? b.password : "";
    const fields: Record<string, string> = {};
    if (!EMAIL.test(email)) fields.email = "Enter a valid email";
    if (!name) fields.name = "Enter your name";
    if (password.length < LIMITS.minPasswordChars) fields.password = `Use at least ${LIMITS.minPasswordChars} characters`;
    if (Object.keys(fields).length) throw new HttpError(400, "Check the highlighted fields", fields);
    if (!emailAllowed(parseAllowlist(env.ALLOWED_EMAILS), email)) throw new HttpError(403, NOT_ALLOWED, { email: NOT_ALLOWED });
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) throw new HttpError(409, "An account with this email already exists", { email: "Already registered. Sign in instead." });
    await limit(env.AUTH_LIMIT, "auth:" + clientIp(req));
    const user: Me = { id: randomId(16), email, name };
    await env.DB.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").bind(user.id, email, name, await hashPassword(password), now()).run();
    return startSession(req, env, user);
  })
  .on("POST", "/api/auth/signin", async (req, env) => {
    const b = await body(req);
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!emailAllowed(parseAllowlist(env.ALLOWED_EMAILS), email)) throw new HttpError(403, NOT_ALLOWED, { email: NOT_ALLOWED });
    await limit(env.AUTH_LIMIT, "auth:" + clientIp(req));
    const row = await env.DB.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?").bind(email).first<Row>();
    if (!row || !(await checkPassword(String(b.password ?? ""), row.password_hash))) throw new HttpError(401, "Email or password is wrong");
    return startSession(req, env, { id: row.id, email: row.email, name: row.name });
  })
  .on("POST", "/api/auth/signout", async (req, env) => {
    const token = sid(req);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": cookieFor(req, "", 0) });
  })
  .on("GET", "/api/me", async (req, env) => json({ user: await currentUser(req, env) }))

  // Library
  .on("GET", "/api/videos", async (req, env) => {
    const user = await requireUser(req, env);
    // Unfinished uploads older than a day are cleaned up here.
    const stale = await env.DB.prepare("SELECT * FROM videos WHERE owner_id = ? AND status = 'uploading' AND created_at < ?").bind(user.id, now() - LIMITS.stuckUploadMs).all<Row>();
    for (const v of stale.results) await deleteVideoData(env, v);
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
    const rows = await env.DB.prepare(
      `SELECT v.*, (SELECT COUNT(*) FROM comments c WHERE c.video_id = v.id) AS comment_count FROM videos v
       WHERE v.owner_id = ? AND v.status = 'ready' AND (? = '' OR instr(lower(v.title), ?) > 0) ORDER BY v.created_at DESC`).bind(user.id, q, q).all<Row>();
    return json({ videos: rows.results.map(summary) });
  })

  // Upload: create → parts → complete
  .on("POST", "/api/videos", async (req, env) => {
    const user = await requireUser(req, env);
    const b = await body(req);
    const contentType = String(b.contentType ?? "");
    if (!CONTENT_TYPES.includes(contentType.split(";")[0])) throw new HttpError(400, "Only WebM or MP4 video");
    if (!MODES.includes(b.mode)) throw new HttpError(400, "Unknown recording mode");
    const w = Number(b.width), h = Number(b.height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 7680 || h > 4320) throw new HttpError(400, "Bad video size");
    const used = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM videos").first<{ n: number }>();
    if ((used?.n ?? 0) >= Number(env.STORAGE_LIMIT_MB || "5000") * 1024 * 1024) throw new HttpError(507, "This site's video storage is full");
    await limit(env.CREATE_LIMIT, "create:" + user.id);
    const id = randomId(12);
    const upload = await env.MEDIA.createMultipartUpload(videoKey(id), { httpMetadata: { contentType } });
    await env.DB.prepare("INSERT INTO videos (id, owner_id, title, status, mode, content_type, upload_id, width, height, created_at) VALUES (?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?)")
      .bind(id, user.id, title(b.title, defaultTitle()), b.mode as Mode, contentType, upload.uploadId, w, h, now()).run();
    return json({ id }, 201);
  })
  .on("PUT", "/api/videos/:id/parts/:n", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    if (v.status !== "uploading") throw new HttpError(409, "This video is already finished");
    const n = Number(p.n);
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new HttpError(400, "Bad part number");
    const len = Number(req.headers.get("content-length"));
    if (!req.body || !len) throw new HttpError(400, "Empty part");
    if (len > LIMITS.maxPartBytes) throw new HttpError(413, "Part too large");
    if (n * LIMITS.partBytes > LIMITS.maxVideoBytes + LIMITS.partBytes) throw new HttpError(413, "Video too large");
    const part = await env.MEDIA.resumeMultipartUpload(videoKey(v.id), v.upload_id).uploadPart(n, req.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  })
  .on("POST", "/api/videos/:id/complete", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    if (v.status !== "uploading") throw new HttpError(409, "This video is already finished");
    const b = await body(req);
    const parts = Array.isArray(b.parts) ? b.parts : [];
    if (!parts.length || parts.some((x: any) => !Number.isInteger(x?.partNumber) || typeof x?.etag !== "string")) throw new HttpError(400, "List the uploaded parts");
    const durationMs = Number(b.durationMs);
    if (!Number.isInteger(durationMs) || durationMs < 500 || durationMs > LIMITS.maxRecordingMs + 5000) throw new HttpError(400, "Bad duration");
    const obj = await env.MEDIA.resumeMultipartUpload(videoKey(v.id), v.upload_id).complete(parts.map((x: any) => ({ partNumber: x.partNumber, etag: x.etag })));
    if (obj.size > LIMITS.maxVideoBytes) { await deleteVideoData(env, { ...v, status: "ready" }); throw new HttpError(413, "Video too large"); }
    await env.DB.prepare("UPDATE videos SET status = 'ready', upload_id = NULL, size = ?, duration_ms = ? WHERE id = ?").bind(obj.size, durationMs, v.id).run();
    return json({ video: summary({ ...v, status: "ready", size: obj.size, duration_ms: durationMs }) });
  })
  .on("DELETE", "/api/videos/:id/upload", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    if (v.status !== "uploading") throw new HttpError(409, "This video is already finished");
    await deleteVideoData(env, v);
    return json({ ok: true });
  })
  .on("PUT", "/api/videos/:id/thumbnail", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    if (req.headers.get("content-type") !== "image/jpeg") throw new HttpError(400, "Thumbnail must be a JPEG");
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > LIMITS.maxThumbnailBytes) throw new HttpError(413, "Thumbnail too large");
    await env.MEDIA.put(thumbKey(v.id), buf, { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB.prepare("UPDATE videos SET has_thumbnail = 1 WHERE id = ?").bind(v.id).run();
    return json({ ok: true });
  })

  // Cutting a saved video: the browser uploads the cut copy as a new object, then the server swaps to it.
  .on("POST", "/api/videos/:id/replace", async (req, env, p) => {
    const { user, v } = await ownVideo(req, env, p.id);
    if (v.status !== "ready") throw new HttpError(409, "Finish the upload first");
    const b = await body(req);
    const contentType = String(b.contentType ?? "");
    if (!CONTENT_TYPES.includes(contentType.split(";")[0])) throw new HttpError(400, "Only WebM or MP4 video");
    const w = Number(b.width), h = Number(b.height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 7680 || h > 4320) throw new HttpError(400, "Bad video size");
    await limit(env.CREATE_LIMIT, "create:" + user.id);
    if (v.pending_key && v.pending_upload_id) await env.MEDIA.resumeMultipartUpload(v.pending_key, v.pending_upload_id).abort().catch(() => {});
    const key = `videos/${v.id}/v-${randomId(10)}`;
    const upload = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType } });
    await env.DB.prepare("UPDATE videos SET pending_key = ?, pending_upload_id = ?, pending_meta = ? WHERE id = ?").bind(key, upload.uploadId, JSON.stringify({ contentType, w, h }), v.id).run();
    return json({ ok: true }, 201);
  })
  .on("PUT", "/api/videos/:id/replace/parts/:n", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    if (!v.pending_key || !v.pending_upload_id) throw new HttpError(409, "Start the replacement first");
    const n = Number(p.n);
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new HttpError(400, "Bad part number");
    const len = Number(req.headers.get("content-length"));
    if (!req.body || !len) throw new HttpError(400, "Empty part");
    if (len > LIMITS.maxPartBytes) throw new HttpError(413, "Part too large");
    if (n * LIMITS.partBytes > LIMITS.maxVideoBytes + LIMITS.partBytes) throw new HttpError(413, "Video too large");
    const part = await env.MEDIA.resumeMultipartUpload(v.pending_key, v.pending_upload_id).uploadPart(n, req.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  })
  .on("POST", "/api/videos/:id/replace/complete", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    if (!v.pending_key || !v.pending_upload_id) throw new HttpError(409, "Start the replacement first");
    const b = await body(req);
    const parts = Array.isArray(b.parts) ? b.parts : [];
    if (!parts.length || parts.some((x: any) => !Number.isInteger(x?.partNumber) || typeof x?.etag !== "string")) throw new HttpError(400, "List the uploaded parts");
    const durationMs = Number(b.durationMs);
    if (!Number.isInteger(durationMs) || durationMs < 500 || durationMs > v.duration_ms + 1000) throw new HttpError(400, "Bad duration");
    const removed = validSpans(b.removed, v.duration_ms);
    if (!removed) throw new HttpError(400, "Bad list of removed parts");
    const removedMs = removed.reduce((n, r) => n + r.end - r.start, 0);
    if (Math.abs(v.duration_ms - removedMs - durationMs) > 1500) throw new HttpError(400, "The cut video's length doesn't match the removed parts");
    const meta = JSON.parse(v.pending_meta ?? "{}");
    const obj = await env.MEDIA.resumeMultipartUpload(v.pending_key, v.pending_upload_id).complete(parts.map((x: any) => ({ partNumber: x.partNumber, etag: x.etag })));
    if (obj.size > LIMITS.maxVideoBytes) {
      await env.MEDIA.delete(v.pending_key);
      await env.DB.prepare("UPDATE videos SET pending_key = NULL, pending_upload_id = NULL, pending_meta = NULL WHERE id = ?").bind(v.id).run();
      throw new HttpError(413, "Video too large");
    }
    // Comments keep their text; inside a removed part they lose their time. Reactions there are deleted.
    const comments = (await env.DB.prepare("SELECT id, time_ms FROM comments WHERE video_id = ? AND time_ms IS NOT NULL").bind(v.id).all<Row>()).results;
    const reactions = (await env.DB.prepare("SELECT id, time_ms FROM reactions WHERE video_id = ?").bind(v.id).all<Row>()).results;
    const fit = (t: number | null) => (t === null || t >= durationMs ? null : t);
    const stmts = [
      env.DB.prepare("UPDATE videos SET media_key = ?, content_type = ?, size = ?, duration_ms = ?, width = ?, height = ?, chapters = ?, pending_key = NULL, pending_upload_id = NULL, pending_meta = NULL WHERE id = ?")
        .bind(v.pending_key, meta.contentType ?? v.content_type, obj.size, durationMs, meta.w ?? v.width, meta.h ?? v.height, JSON.stringify(remapChapters(JSON.parse(v.chapters), removed, durationMs)), v.id),
      ...comments.map(c => env.DB.prepare("UPDATE comments SET time_ms = ? WHERE id = ?").bind(fit(remapTime(c.time_ms, removed)), c.id)),
      ...reactions.map(r => { const t = fit(remapTime(r.time_ms, removed)); return t === null ? env.DB.prepare("DELETE FROM reactions WHERE id = ?").bind(r.id) : env.DB.prepare("UPDATE reactions SET time_ms = ? WHERE id = ?").bind(t, r.id); }),
    ];
    await env.DB.batch(stmts);
    const old = mediaKey(v);
    if (old !== v.pending_key) await env.MEDIA.delete(old); // the uncut file is gone for good
    return json({ video: summary({ ...v, size: obj.size, duration_ms: durationMs }) });
  })
  .on("DELETE", "/api/videos/:id/replace", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    if (v.pending_key && v.pending_upload_id) await env.MEDIA.resumeMultipartUpload(v.pending_key, v.pending_upload_id).abort().catch(() => {});
    await env.DB.prepare("UPDATE videos SET pending_key = NULL, pending_upload_id = NULL, pending_meta = NULL WHERE id = ?").bind(v.id).run();
    return json({ ok: true });
  })

  // One video (public for anyone with the link)
  .on("GET", "/api/videos/:id", async (req, env, p) => {
    const v = await readyVideo(env, p.id);
    const user = await currentUser(req, env);
    const reactions = await env.DB.prepare("SELECT id, emoji, time_ms FROM reactions WHERE video_id = ? ORDER BY time_ms").bind(v.id).all<Row>();
    const cc = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE video_id = ?").bind(v.id).first<{ n: number }>();
    const d: VideoDetail = {
      ...summary({ ...v, comment_count: cc?.n ?? 0 }), ownerName: v.owner_name, isOwner: user?.id === v.owner_id, contentType: v.content_type,
      width: v.width, height: v.height, chapters: JSON.parse(v.chapters), allowComments: !!v.allow_comments, allowDownload: !!v.allow_download,
      reactions: reactions.results.map(r => ({ id: r.id, emoji: r.emoji, timeMs: r.time_ms })),
    };
    return json({ video: d });
  })
  .on("PATCH", "/api/videos/:id", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    if (v.status !== "ready") throw new HttpError(409, "Finish the upload first");
    const b = await body(req);
    const next = { title: v.title, chapters: v.chapters, allow_comments: v.allow_comments, allow_download: v.allow_download };
    if ("title" in b) next.title = title(b.title);
    if ("chapters" in b) next.chapters = JSON.stringify(cleanChapters(b.chapters, v.duration_ms));
    if ("allowComments" in b) next.allow_comments = b.allowComments ? 1 : 0;
    if ("allowDownload" in b) next.allow_download = b.allowDownload ? 1 : 0;
    await env.DB.prepare("UPDATE videos SET title = ?, chapters = ?, allow_comments = ?, allow_download = ? WHERE id = ?").bind(next.title, next.chapters, next.allow_comments, next.allow_download, v.id).run();
    return json({ ok: true });
  })
  .on("DELETE", "/api/videos/:id", async (req, env, p) => {
    const { v } = await ownVideo(req, env, p.id);
    await deleteVideoData(env, v);
    return json({ ok: true });
  })
  .on("GET", "/api/videos/:id/media", async (req, env, p) => {
    const v = await readyVideo(env, p.id);
    const download = new URL(req.url).searchParams.has("download");
    if (download && !v.allow_download && (await currentUser(req, env))?.id !== v.owner_id)
      throw new HttpError(403, "Downloads are turned off for this video");
    const head = await env.MEDIA.head(mediaKey(v));
    if (!head) throw new HttpError(404, "Video not found");
    const range = parseRange(req.headers.get("range"), head.size);
    if (range === "invalid") return new Response(null, { status: 416, headers: { "content-range": `bytes */${head.size}` } });
    const headers = new Headers({ "content-type": v.content_type.split(";")[0], "accept-ranges": "bytes", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
    if (download) headers.set("content-disposition", `attachment; filename="${v.title.replace(/[^\w .-]+/g, "").trim() || "video"}.${v.content_type.includes("mp4") ? "mp4" : "webm"}"`);
    if (req.method === "HEAD") { headers.set("content-length", String(head.size)); return new Response(null, { headers }); }
    const obj = await env.MEDIA.get(mediaKey(v), range ? { range } : {});
    if (!obj) throw new HttpError(404, "Video not found");
    const start = range ? range.offset : 0;
    const body = await repairWebm(env, v, head.size, start, range ? range.length : head.size, obj.body);
    if (range) {
      headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
      headers.set("content-length", String(range.length));
      return new Response(body, { status: 206, headers });
    }
    headers.set("content-length", String(head.size));
    return new Response(body, { headers });
  })
  .on("GET", "/api/videos/:id/thumbnail", async (_req, env, p) => {
    const v = await readyVideo(env, p.id);
    const obj = v.has_thumbnail ? await env.MEDIA.get(thumbKey(v.id)) : null;
    if (!obj) throw new HttpError(404, "No thumbnail");
    return new Response(obj.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
  })

  // Comments, reactions, views
  .on("GET", "/api/videos/:id/comments", async (req, env, p) => {
    const v = await readyVideo(env, p.id);
    const viewer = viewerOf(req);
    const rows = await env.DB.prepare("SELECT * FROM comments WHERE video_id = ? ORDER BY created_at, id").bind(v.id).all<Row>();
    const comments: Comment[] = rows.results.map(r => ({ id: r.id, authorName: r.author_name, body: r.body, timeMs: r.time_ms, createdAt: r.created_at, mine: !!viewer && r.viewer_id === viewer, byOwner: r.author_user_id === v.owner_id }));
    return json({ comments });
  })
  .on("POST", "/api/videos/:id/comments", async (req, env, p) => {
    const v = await readyVideo(env, p.id);
    const user = await currentUser(req, env);
    if (!v.allow_comments && user?.id !== v.owner_id) throw new HttpError(403, "Comments are turned off for this video");
    const b = await body(req);
    const viewer = viewerOf(req);
    if (!viewer) throw new HttpError(400, "Missing viewer id");
    const name = (user?.name ?? (typeof b.name === "string" ? b.name.trim() : "")).slice(0, LIMITS.nameChars);
    const text = typeof b.body === "string" ? b.body.trim() : "";
    if (!name) throw new HttpError(400, "Add your name", { name: "Required" });
    if (!text) throw new HttpError(400, "Write a comment", { body: "Required" });
    if (text.length > LIMITS.commentChars) throw new HttpError(400, `Comments are at most ${LIMITS.commentChars} characters`, { body: "Too long" });
    const timeMs = b.timeMs === null || b.timeMs === undefined ? null : Number(b.timeMs);
    if (timeMs !== null && (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > v.duration_ms)) throw new HttpError(400, "Bad timestamp");
    await limit(env.WRITE_LIMIT, "write:" + clientIp(req));
    const c = { id: randomId(16), created_at: now() };
    await env.DB.prepare("INSERT INTO comments (id, video_id, author_name, author_user_id, viewer_id, body, time_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(c.id, v.id, name, user?.id ?? null, viewer, text, timeMs, c.created_at).run();
    const out: Comment = { id: c.id, authorName: name, body: text, timeMs, createdAt: c.created_at, mine: true, byOwner: user?.id === v.owner_id };
    return json({ comment: out }, 201);
  })
  .on("DELETE", "/api/videos/:id/comments/:cid", async (req, env, p) => {
    const v = await readyVideo(env, p.id);
    const c = await env.DB.prepare("SELECT * FROM comments WHERE id = ? AND video_id = ?").bind(p.cid, v.id).first<Row>();
    if (!c) throw new HttpError(404, "Comment not found");
    const user = await currentUser(req, env);
    if (user?.id !== v.owner_id && viewerOf(req) !== c.viewer_id) throw new HttpError(403, "You can only delete your own comments");
    await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(c.id).run();
    return json({ ok: true });
  })
  .on("POST", "/api/videos/:id/reactions", async (req, env, p) => {
    const v = await readyVideo(env, p.id);
    const b = await body(req);
    const viewer = viewerOf(req);
    if (!viewer) throw new HttpError(400, "Missing viewer id");
    if (!REACTIONS.includes(b.emoji)) throw new HttpError(400, "Unknown reaction");
    const timeMs = Number(b.timeMs);
    if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > v.duration_ms) throw new HttpError(400, "Bad timestamp");
    await limit(env.WRITE_LIMIT, "write:" + clientIp(req));
    const id = randomId(16);
    await env.DB.prepare("INSERT INTO reactions (id, video_id, emoji, time_ms, viewer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, v.id, b.emoji, timeMs, viewer, now()).run();
    return json({ reaction: { id, emoji: b.emoji, timeMs } }, 201);
  })
  .on("POST", "/api/videos/:id/views", async (req, env, p) => {
    const v = await readyVideo(env, p.id);
    const viewer = viewerOf(req);
    if (!viewer) throw new HttpError(400, "Missing viewer id");
    const user = await currentUser(req, env);
    if (user?.id === v.owner_id) return json({ counted: false, viewCount: v.view_count });
    await limit(env.WRITE_LIMIT, "write:" + clientIp(req));
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO views (video_id, viewer_id, created_at) VALUES (?, ?, ?)").bind(v.id, viewer, now()).run();
    const counted = ins.meta.changes > 0;
    if (counted) await env.DB.prepare("UPDATE videos SET view_count = view_count + 1 WHERE id = ?").bind(v.id).run();
    return json({ counted, viewCount: v.view_count + (counted ? 1 : 0) });
  });

function defaultTitle() {
  return "Recording " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      checkOrigin(req);
      return await router.handle(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, fields: e.fields }, e.status);
      console.error(e);
      return json({ error: "Something went wrong" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
