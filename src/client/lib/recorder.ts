import fixWebmDuration from "fix-webm-duration";
import { applyPatches, webmHeaderPatches } from "../../shared/webm";
import type { Mode } from "../../shared/limits";

export type BubbleSize = "sm" | "md" | "lg";
/** Bubble centre as a fraction of the frame; diameter as a fraction of the frame's shorter side. */
export type Bubble = { x: number; y: number; size: BubbleSize };
export const BUBBLE_DIAMETER: Record<BubbleSize, number> = { sm: 0.22, md: 0.3, lg: 0.42 };
export const MARGIN = 0.035;

/** Keeps the whole bubble inside the frame. */
export function clampBubble(b: Bubble, w: number, h: number): Bubble {
  const r = (BUBBLE_DIAMETER[b.size] * Math.min(w, h)) / 2, m = MARGIN * Math.min(w, h);
  const cx = Math.min(Math.max(b.x * w, r + m), w - r - m), cy = Math.min(Math.max(b.y * h, r + m), h - r - m);
  return { ...b, x: cx / w, y: cy / h };
}
export const DEFAULT_BUBBLE: Bubble = { x: 0, y: 1, size: "md" }; // bottom-left, clamped when drawn

/**
 * MP4 with H.264 first: it plays everywhere, including Safari on iPhone. Chrome 126+ records it
 * (with AAC on macOS, Windows and Android; with Opus where it has no AAC encoder, e.g. Linux),
 * and Safari records it natively. WebM is the fallback (Firefox).
 */
export const MIME_PREFERENCE = [
  "video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1,opus",
  "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4",
];
export function pickMimeType(supported: (t: string) => boolean = t => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)): string {
  for (const t of MIME_PREFERENCE) if (supported(t)) return t;
  return "";
}
export const canRecordScreen = () => !!navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices;

/** Draws a camera frame as a circle with a soft ring, cover-cropped to a square. */
export function drawBubble(ctx: CanvasRenderingContext2D, cam: HTMLVideoElement, b: Bubble, w: number, h: number) {
  const c = clampBubble(b, w, h);
  const d = BUBBLE_DIAMETER[b.size] * Math.min(w, h), r = d / 2, cx = c.x * w, cy = c.y * h;
  const vw = cam.videoWidth, vh = cam.videoHeight;
  if (!vw || !vh) return;
  const side = Math.min(vw, vh);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = r * 0.18; ctx.shadowOffsetY = r * 0.05;
  ctx.beginPath(); ctx.arc(cx, cy, r + Math.max(2, r * 0.035), 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  // Mirror the camera, as people expect to see themselves.
  ctx.translate(cx + r, cy - r); ctx.scale(-1, 1);
  ctx.drawImage(cam, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, d, d);
  ctx.restore();
}

function video(stream: MediaStream): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.srcObject = stream;
  return v.play().then(() => v);
}

/** Writes the duration into a WebM recording (so it can be seeked), keeping the Segment and Clusters as the browser wrote them. */
export async function fixWebm(blob: Blob, durationMs: number): Promise<Blob> {
  const fixed = await fixWebmDuration(blob, durationMs, { logger: false });
  const head = new Uint8Array(await fixed.slice(0, 4096).arrayBuffer());
  const patches = webmHeaderPatches(head, fixed.size);
  if (!patches.length) return fixed;
  return new Blob([applyPatches(head, 0, patches) as Uint8Array<ArrayBuffer>, fixed.slice(head.length)], { type: fixed.type });
}

/** A ticker in a Web Worker keeps the canvas drawing while this tab is in the background (timers there are throttled). */
function ticker(fps: number, onTick: () => void) {
  const src = `let id=setInterval(()=>postMessage(0),${Math.round(1000 / fps)});onmessage=()=>clearInterval(id)`;
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const w = new Worker(url);
  w.onmessage = onTick;
  return () => { w.postMessage(0); w.terminate(); URL.revokeObjectURL(url); };
}

export type Recording = { blob: Blob; durationMs: number; width: number; height: number; mimeType: string; mode: Mode; thumbnail: Blob | null };

export class RecordingSession {
  screen: MediaStream | null = null;
  camera: MediaStream | null = null;
  output: MediaStream | null = null;
  width = 0; height = 0;
  bubble: Bubble;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopTicker: (() => void) | null = null;
  private audioCtx: AudioContext | null = null;
  private elapsedBefore = 0;
  private runningSince = 0;
  private thumb: Promise<Blob | null> | null = null;
  private thumbTimer = 0;
  state: "idle" | "ready" | "recording" | "paused" | "stopped" = "idle";
  /** What was shared: "browser" (a tab), "window", "monitor" (a whole screen), or "unknown". */
  surface = "none";
  /** True when the browser was asked to switch to the shared tab or window. */
  focusedAway = false;
  onEnded: (() => void) | null = null;

  constructor(public mode: Mode, public mic: boolean, bubble: Bubble, public camera0: MediaStream | null) { this.bubble = bubble; this.camera = camera0; }

  /** Asks for the screen (screen modes) and builds the stream to record. */
  async prepare() {
    const wantsScreen = this.mode !== "camera";
    if (wantsScreen) {
      // Keep this page out of the picker, let people switch what they share mid-recording, and (Chrome)
      // jump straight to the shared tab or window so this page isn't what gets recorded.
      const CC = (globalThis as any).CaptureController;
      const controller = CC ? new CC() : undefined;
      this.screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true,
        selfBrowserSurface: "exclude", preferCurrentTab: false, surfaceSwitching: "include", monitorTypeSurfaces: "include", systemAudio: "include",
        ...(controller ? { controller } : {}),
      } as DisplayMediaStreamOptions);
      const track = this.screen.getVideoTracks()[0];
      this.surface = (track.getSettings() as { displaySurface?: string }).displaySurface ?? "unknown";
      if (controller && (this.surface === "browser" || this.surface === "window")) {
        try { (controller as any).setFocusBehavior("focus-captured-surface"); this.focusedAway = true; } catch { /* not supported or too late */ }
      }
      track.addEventListener("ended", () => this.onEnded?.());
    }
    const needCamera = this.mode !== "screen";
    const wantVideo = needCamera && !this.camera?.getVideoTracks().length;
    const wantAudio = this.mic && !this.camera?.getAudioTracks().length;
    if (wantVideo || wantAudio) {
      const s = await navigator.mediaDevices.getUserMedia({ video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false, audio: wantAudio });
      this.camera = new MediaStream([...(this.camera?.getTracks() ?? []), ...s.getTracks()]);
    }
    let videoTrack: MediaStreamTrack;
    if (this.mode === "screen_camera") {
      const sv = await video(this.screen!), cv = await video(new MediaStream(this.camera!.getVideoTracks()));
      const scale = Math.min(1, 1920 / Math.max(sv.videoWidth, sv.videoHeight));
      this.width = Math.round((sv.videoWidth * scale) / 2) * 2; this.height = Math.round((sv.videoHeight * scale) / 2) * 2;
      const canvas = document.createElement("canvas");
      canvas.width = this.width; canvas.height = this.height;
      const ctx = canvas.getContext("2d")!;
      const draw = () => {
        if (sv.videoWidth && (Math.round(sv.videoWidth * scale) !== this.width)) { /* screen size changed mid-recording: keep the frame, letterbox */ }
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, this.width, this.height);
        const k = Math.min(this.width / sv.videoWidth, this.height / sv.videoHeight);
        const dw = sv.videoWidth * k, dh = sv.videoHeight * k;
        ctx.drawImage(sv, (this.width - dw) / 2, (this.height - dh) / 2, dw, dh);
        drawBubble(ctx, cv, this.bubble, this.width, this.height);
      };
      draw();
      this.stopTicker = ticker(30, draw);
      videoTrack = canvas.captureStream(30).getVideoTracks()[0];
    } else {
      videoTrack = (this.mode === "screen" ? this.screen! : this.camera!).getVideoTracks()[0];
      // The element reports the frame as shown (phones rotate the camera), the track settings may not.
      const el = await video(new MediaStream([videoTrack])).catch(() => null);
      const s = videoTrack.getSettings();
      this.width = el?.videoWidth || s.width || 1280; this.height = el?.videoHeight || s.height || 720;
      if (el) el.srcObject = null;
    }
    this.output = new MediaStream([videoTrack, ...this.mixAudio()]);
    this.state = "ready";
  }

  private mixAudio(): MediaStreamTrack[] {
    const sources = [...(this.mic ? this.camera?.getAudioTracks() ?? [] : []), ...(this.screen?.getAudioTracks() ?? [])];
    if (sources.length <= 1) return sources;
    this.audioCtx = new AudioContext();
    const dest = this.audioCtx.createMediaStreamDestination();
    for (const t of sources) this.audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest);
    return dest.stream.getAudioTracks();
  }

  start() {
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.output!, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
    this.chunks = [];
    this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start(1000);
    this.runningSince = performance.now(); this.elapsedBefore = 0;
    this.state = "recording";
    this.thumbTimer = window.setTimeout(() => (this.thumb = this.grabThumbnail()), 1000);
  }
  elapsed() { return this.elapsedBefore + (this.state === "recording" ? performance.now() - this.runningSince : 0); }
  pause() { if (this.state !== "recording") return; this.recorder!.pause(); this.elapsedBefore = this.elapsed(); this.state = "paused"; }
  resume() { if (this.state !== "paused") return; this.recorder!.resume(); this.runningSince = performance.now(); this.state = "recording"; }

  private grabThumbnail(): Promise<Blob | null> {
    const track = this.output?.getVideoTracks()[0];
    if (!track) return Promise.resolve(null);
    return video(new MediaStream([track.clone()])).then(v => new Promise<Blob | null>(res => {
      const w = 640, h = Math.round((640 * (v.videoHeight || 9)) / (v.videoWidth || 16));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(v, 0, 0, w, h);
      (v.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      c.toBlob(b => res(b), "image/jpeg", 0.82);
    })).catch(() => null);
  }

  /** Stops and returns the finished file, with its duration written into the WebM header so players can seek. */
  async stop(): Promise<Recording> {
    const durationMs = this.elapsed();
    if (!this.thumb) this.thumb = this.grabThumbnail();
    const thumbnail = await this.thumb;
    const r = this.recorder!;
    const done = new Promise<void>(res => (r.onstop = () => res()));
    if (r.state !== "inactive") r.stop();
    await done;
    this.state = "stopped";
    const mimeType = r.mimeType || pickMimeType() || "video/webm";
    let blob = new Blob(this.chunks, { type: mimeType.split(";")[0] });
    if (mimeType.includes("webm")) blob = await fixWebm(blob, durationMs);
    this.release();
    return { blob, durationMs, width: this.width, height: this.height, mimeType: mimeType.split(";")[0], mode: this.mode, thumbnail };
  }

  /** Throws away what was recorded so far and starts again with the same screen and camera. */
  restart() {
    const r = this.recorder;
    if (r && r.state !== "inactive") { r.ondataavailable = null; r.onstop = null; r.stop(); }
    clearTimeout(this.thumbTimer); this.thumb = null;
    this.start();
  }

  /** Discards everything: used by cancel and restart. */
  discard() {
    if (this.recorder && this.recorder.state !== "inactive") { this.recorder.ondataavailable = null; this.recorder.stop(); }
    this.chunks = []; this.release(); this.state = "stopped";
  }
  private release() {
    clearTimeout(this.thumbTimer);
    this.stopTicker?.(); this.stopTicker = null;
    this.screen?.getTracks().forEach(t => t.stop());
    this.audioCtx?.close().catch(() => {});
    // The camera preview stream belongs to the page; only stop tracks this session opened itself.
    if (this.camera && this.camera !== this.camera0) this.camera.getTracks().filter(t => !this.camera0?.getTracks().includes(t)).forEach(t => t.stop());
  }
}
