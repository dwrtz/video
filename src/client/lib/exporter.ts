/**
 * Cuts a recording in the browser before it is uploaded, so the removed parts never leave the device.
 *
 * 1. WebCodecs (Chrome/Edge 94+, Safari 17+ for video, with audio where the browser has an AudioEncoder):
 *    decode the kept frames with Mediabunny, re-time them end to end, and encode H.264 (+ AAC, or Opus where
 *    there is no AAC encoder) into an MP4. Frame-accurate and usually faster than real time.
 * 2. Fallback (no usable encoder, e.g. Firefox or older Safari): play the kept parts in a hidden <video> and
 *    record them with MediaRecorder, pausing over the removed section. Takes as long as the kept part.
 */
import { pickMimeType, fixWebm } from "./recorder";
import { segments, type Edits } from "../../shared/time";

export type ExportMethod = "webcodecs" | "realtime";
export type ExportResult = { blob: Blob; durationMs: number; width: number; height: number; mimeType: string; method: ExportMethod };
export type ExportOptions = { edits: Edits; muted: boolean; onProgress?: (fraction: number) => void; signal?: AbortSignal; method?: ExportMethod };

const abortError = () => new DOMException("Export cancelled", "AbortError");
export const isAbort = (e: unknown) => (e as any)?.name === "AbortError";
const VIDEO_BITRATE = 2_500_000, AUDIO_BITRATE = 128_000;

export async function exportCut(source: Blob, o: ExportOptions): Promise<ExportResult> {
  const forced = o.method ?? ((globalThis as any).__exportMethod as ExportMethod | undefined);
  if (forced !== "realtime") {
    try {
      const r = await exportWebCodecs(source, o);
      if (r) return r;
    } catch (e) {
      if (isAbort(e)) throw e;
      if (forced === "webcodecs") throw e;
      console.warn("WebCodecs export failed, recording the kept parts in real time instead", e);
    }
    if (forced === "webcodecs") throw new Error("This browser can't encode H.264 with WebCodecs");
  }
  return exportRealtime(source, o);
}

/** Returns null when this browser can't do it (checked before any work starts). */
async function exportWebCodecs(source: Blob, o: ExportOptions): Promise<ExportResult | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return null;
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(source), formats: mb.ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return null;
    const width = vt.displayWidth, height = vt.displayHeight;
    if (!(await mb.canEncodeVideo("avc", { width, height, bitrate: VIDEO_BITRATE }))) return null;
    const at = o.muted ? null : await input.getPrimaryAudioTrack();
    let audioCodec: "aac" | "opus" | null = null;
    if (at) {
      if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined" || !(await at.canDecode())) return null;
      audioCodec = (await mb.getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: at.numberOfChannels, sampleRate: at.sampleRate, bitrate: AUDIO_BITRATE })) as "aac" | "opus" | null;
      if (!audioCodec) return null;
    }
    const segs = segments(o.edits).map(([s, e]) => [s / 1000, e / 1000] as const);
    const total = segs.reduce((n, [s, e]) => n + (e - s), 0);
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const vs = new mb.VideoSampleSource({ codec: "avc", bitrate: VIDEO_BITRATE, keyFrameInterval: 2, sizeChangeBehavior: "contain" });
    output.addVideoTrack(vs, { frameRate: 30 });
    const as = at && audioCodec ? new mb.AudioSampleSource({ codec: audioCodec, bitrate: AUDIO_BITRATE }) : null;
    if (as) output.addAudioTrack(as);
    await output.start();
    const check = () => { if (o.signal?.aborted) throw abortError(); };
    let done = 0;
    const video = async () => {
      const sink = new mb.VideoSampleSink(vt);
      let offset = 0;
      for (const [s, e] of segs) {
        let first = true;
        for await (const sample of sink.samples(s, e)) {
          try {
            check();
            // The frame showing at the cut point may start a little before it; it starts the new part exactly.
            const t = first ? offset : Math.max(offset, sample.timestamp - s + offset);
            first = false;
            sample.setTimestamp(t);
            await vs.add(sample);
            done = Math.max(done, t); o.onProgress?.(Math.min(0.99, done / total));
          } finally { sample.close(); }
        }
        offset += e - s;
      }
      vs.close();
    };
    const audio = async () => {
      if (!as || !at) return;
      const sink = new mb.AudioSampleSink(at);
      let offset = 0;
      for (const [s, e] of segs) {
        for await (const sample of sink.samples(s, e)) {
          let piece = sample;
          try {
            check();
            const sr = sample.sampleRate, n = sample.numberOfFrames;
            const from = Math.max(0, Math.round((s - sample.timestamp) * sr));
            const to = Math.min(n, Math.round((e - sample.timestamp) * sr));
            if (to <= from) continue;
            if (from > 0 || to < n) piece = sample.trim(from, to);
            piece.setTimestamp(Math.max(offset, piece.timestamp - s + offset));
            await as.add(piece);
          } finally { if (piece !== sample) piece.close(); sample.close(); }
        }
        offset += e - s;
      }
      as.close();
    };
    try { await Promise.all([video(), audio()]); check(); await output.finalize(); }
    catch (e) { await output.cancel().catch(() => {}); throw e; }
    o.onProgress?.(1);
    const buf = output.target.buffer!;
    return { blob: new Blob([buf], { type: "video/mp4" }), durationMs: Math.round(total * 1000), width, height, mimeType: "video/mp4", method: "webcodecs" };
  } finally { input.dispose?.(); }
}

/** Plays the kept parts and records them. Needs MediaRecorder; runs in real time. */
async function exportRealtime(source: Blob, o: ExportOptions): Promise<ExportResult> {
  if (typeof MediaRecorder === "undefined") throw new Error("This browser can't cut videos");
  const segs = segments(o.edits);
  const total = segs.reduce((n, [s, e]) => n + (e - s), 0);
  const url = URL.createObjectURL(source);
  const v = document.createElement("video");
  v.src = url; v.playsInline = true; v.preload = "auto"; v.muted = o.muted;
  v.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px";
  document.body.appendChild(v);
  let ctx: AudioContext | null = null, rec: MediaRecorder | null = null, ticker = 0;
  const cleanup = () => { cancelAnimationFrame(ticker); v.pause(); v.remove(); URL.revokeObjectURL(url); ctx?.close().catch(() => {}); };
  try {
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("Couldn't read the recording")); });
    const width = v.videoWidth & ~1 || 2, height = v.videoHeight & ~1 || 2;
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const g = canvas.getContext("2d")!;
    const draw = () => { g.drawImage(v, 0, 0, width, height); ticker = requestAnimationFrame(draw); };
    const stream = canvas.captureStream(30);
    if (!o.muted) {
      ctx = new AudioContext(); await ctx.resume().catch(() => {});
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaElementSource(v).connect(dest); // routed only into the recording, not the speakers
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    }
    const mimeType = pickMimeType();
    rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>(r => (rec!.onstop = () => r()));
    const seekTo = (s: number) => new Promise<void>(r => { v.addEventListener("seeked", () => r(), { once: true }); v.currentTime = s / 1000; });
    const frames = (n: number) => new Promise<void>(r => { const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step)); step(); });
    let before = 0;
    for (const [s, e] of segs) {
      if (o.signal?.aborted) throw abortError();
      cancelAnimationFrame(ticker);
      await seekTo(s); g.drawImage(v, 0, 0, width, height);
      await frames(2); // let the canvas stream carry the new frame before recording resumes
      draw();
      await v.play(); // record only once playback is moving, so no frozen frames are added
      if (rec.state === "inactive") rec.start(1000); else rec.resume();
      await new Promise<void>((res, rej) => {
        // Checked on every frame where possible, and on a timer too (no frames arrive after the file ends).
        let over = false;
        const finish = (err?: Error) => { if (over) return; over = true; clearInterval(timer); v.removeEventListener("ended", onEnd); v.pause(); if (rec!.state === "recording") rec!.pause(); err ? rej(err) : res(); };
        const tick = () => {
          if (over) return;
          if (o.signal?.aborted) { finish(abortError()); return; }
          const ms = v.currentTime * 1000;
          o.onProgress?.(Math.min(0.99, (before + Math.max(0, ms - s)) / total));
          if (ms >= e - 15 || v.ended) { finish(); return; }
          (v as any).requestVideoFrameCallback?.(tick);
        };
        const onEnd = () => finish();
        v.addEventListener("ended", onEnd);
        const timer = setInterval(tick, 30);
        tick();
      });
      before += e - s;
    }
    rec.stop(); await stopped;
    const type = rec.mimeType || mimeType || "video/webm";
    let blob = new Blob(chunks, { type });
    if (type.includes("webm")) blob = await fixWebm(blob, total);
    o.onProgress?.(1);
    // Real-time recording adds a little slack at each segment start; store the file's real length.
    let durationMs = Math.round(total);
    try {
      const mb = await import("mediabunny");
      const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
      const d = await input.computeDuration();
      if (Number.isFinite(d) && d > 0) durationMs = Math.round(d * 1000);
    } catch { /* keep the planned length */ }
    return { blob, durationMs, width, height, mimeType: type, method: "realtime" };
  } catch (e) {
    if (rec && rec.state !== "inactive") rec.stop();
    throw e;
  } finally { cleanup(); }
}

/** A 640-px-wide JPEG from one second in (or the middle of a shorter video). */
export async function thumbnailOf(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(); setTimeout(rej, 10_000); });
    const at = Math.min(1, (isFinite(v.duration) ? v.duration : 2) / 2);
    await new Promise<void>(r => { v.addEventListener("seeked", () => r(), { once: true }); v.currentTime = at; setTimeout(r, 3000); });
    const w = 640, h = Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * w) || 360;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    return await new Promise<Blob | null>(r => c.toBlob(b => r(b), "image/jpeg", 0.82));
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
