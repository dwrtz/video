import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../App";
import { LIMITS, type Mode } from "../../shared/limits";
import { formatTime, validCut, validTrim } from "../../shared/time";
import { BUBBLE_DIAMETER, DEFAULT_BUBBLE, RecordingSession, canRecordScreen, clampBubble, type Bubble, type BubbleSize } from "../lib/recorder";
import { uploadRecording } from "../lib/upload";
import type { Recording } from "../lib/recorder";
import { TrimEditor, toEdits, type TrimValue } from "../components/TrimEditor";
import { Confirm } from "../components/ui";
import { IconCamera, IconMic, IconMicOff, IconPause, IconPlay, IconPopOut, IconRestart, IconScreen, IconScreenCam, IconStop, IconTrash } from "../components/Icons";

type Phase = "setup" | "starting" | "countdown" | "recording" | "finishing" | "review" | "uploading";
type Review = { rec: Recording; url: string; poster?: string; title: string; trim: TrimValue; muted: boolean };
const pipSupported = () => typeof window !== "undefined" && "documentPictureInPicture" in window;
const defaultTitle = () => `Recording · ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
const MODE_INFO: { mode: Mode; label: string; Icon: typeof IconScreen }[] = [
  { mode: "screen_camera", label: "Screen + camera", Icon: IconScreenCam },
  { mode: "screen", label: "Screen only", Icon: IconScreen },
  { mode: "camera", label: "Camera only", Icon: IconCamera },
];

export function RecorderPage() {
  const screenOk = canRecordScreen();
  const [mode, setMode] = useState<Mode>(() => (screenOk ? (localStorage.getItem("av.mode") as Mode) || "screen_camera" : "camera"));
  const [mic, setMic] = useState(() => localStorage.getItem("av.mic") !== "off");
  const [countdownOn, setCountdownOn] = useState(() => localStorage.getItem("av.countdown") !== "off");
  const [bubble, setBubble] = useState<Bubble>(() => { try { return { ...DEFAULT_BUBBLE, ...JSON.parse(localStorage.getItem("av.bubble") ?? "{}") }; } catch { return DEFAULT_BUBBLE; } });
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [count, setCount] = useState(3);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<RecordingSession | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pip, setPipState] = useState<Window | null>(null);
  const pipRef = useRef<Window | null>(null);
  const setPip = (w: Window | null) => { pipRef.current = w; setPipState(w); };
  const [surface, setSurface] = useState("none");
  const nav = useNavigate();
  const needsCamera = mode !== "screen";

  useEffect(() => { localStorage.setItem("av.mode", mode); localStorage.setItem("av.mic", mic ? "on" : "off"); localStorage.setItem("av.countdown", countdownOn ? "on" : "off"); localStorage.setItem("av.bubble", JSON.stringify(bubble)); }, [mode, mic, countdownOn, bubble]);
  useEffect(() => { if (session.current) session.current.bubble = bubble; }, [bubble]);

  // Camera preview while setting up.
  useEffect(() => {
    if (!needsCamera) return;
    let stream: MediaStream | null = null, live = true;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(s => { if (!live) { s.getTracks().forEach(t => t.stop()); return; } stream = s; setCamera(s); setError(null); })
      .catch(() => setError("Camera access was blocked. Allow the camera in your browser, or record your screen only."));
    return () => { live = false; stream?.getTracks().forEach(t => t.stop()); setCamera(null); };
  }, [needsCamera]);

  // Timer while recording; stops itself at the limit.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const s = session.current; if (!s) return;
      const e = s.elapsed(); setElapsed(e);
      if (e >= LIMITS.maxRecordingMs) finish();
    }, 200);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => session.current?.discard(), []);
  // Don't lose an unsaved recording by closing the tab.
  useEffect(() => {
    if (phase !== "review" && phase !== "uploading" && phase !== "recording") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);
  useEffect(() => () => { if (review) { URL.revokeObjectURL(review.url); if (review.poster) URL.revokeObjectURL(review.poster); } }, [review?.url]);
  // Keyboard: Alt+Shift+S finishes, Alt+Shift+P pauses or resumes (here and in the floating controls).
  useEffect(() => {
    if (phase !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) return;
      if (e.code === "KeyS") { e.preventDefault(); finish(); }
      if (e.code === "KeyP") { e.preventDefault(); togglePause(); }
    };
    window.addEventListener("keydown", onKey); pip?.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); pip?.removeEventListener("keydown", onKey); };
  }, [phase, pip]);
  const closePip = () => { pipRef.current?.close(); setPip(null); };
  /** Floating always-on-top controls (Chrome 116+): needs a click, so it opens right after the picker when the click still counts, or from the "Pop out" button. */
  const openPip = async () => {
    if (!pipSupported() || pipRef.current) return;
    try {
      const w: Window = await (window as any).documentPictureInPicture.requestWindow({ width: 340, height: 96 });
      copyStyles(w); w.document.title = "Recording controls";
      w.addEventListener("pagehide", () => setPip(null));
      setPip(w);
    } catch { /* needs a fresh click; the in-page controls and the browser's Stop sharing bar still work */ }
  };

  const start = async () => {
    setError(null); setPhase("starting");
    const s = new RecordingSession(mode, mic, bubble, needsCamera ? camera : null);
    try { await s.prepare(); }
    catch (e: any) {
      s.discard(); setPhase("setup");
      setError(e?.name === "NotAllowedError" ? (mode === "camera" ? "Camera or microphone access was blocked." : "Screen sharing was cancelled. Pick a screen, window or tab to record.") : `Couldn't start recording: ${e?.message ?? e}`);
      return;
    }
    s.onEnded = () => finish();
    session.current = s;
    setSurface(s.surface);
    if (s.mode !== "camera" && (navigator as any).userActivation?.isActive) await openPip();
    if (countdownOn) { setCount(3); setPhase("countdown"); } else begin();
  };
  const begin = () => { session.current!.start(); setPaused(false); setElapsed(0); setPhase("recording"); };

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count === 0) { begin(); return; }
    const t = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, count]);

  const finishing = useRef(false);
  /** Stop → keep the recording in this tab and open the review step. Nothing is uploaded yet. */
  async function finish() {
    const s = session.current; if (!s || finishing.current || (s.state !== "recording" && s.state !== "paused")) return;
    finishing.current = true;
    setPhase("finishing"); closePip();
    try {
      const rec = await s.stop();
      session.current = null;
      const D = Math.max(1, Math.round(rec.durationMs));
      setReview({ rec: { ...rec, durationMs: D }, url: URL.createObjectURL(rec.blob), poster: rec.thumbnail ? URL.createObjectURL(rec.thumbnail) : undefined, title: defaultTitle(), trim: { start: 0, end: D, cut: null }, muted: false });
      setPhase("review");
      window.focus();
    } catch (e: any) {
      setError(`Couldn't finish the recording: ${e?.message ?? e}`); setPhase("setup");
    } finally { finishing.current = false; }
  }
  const save = async () => {
    const r = review!; setError(null);
    const D = r.rec.durationMs;
    const bad = validTrim(D, r.trim.start, r.trim.end) ?? validCut(toEdits(D, r.trim));
    if (bad) { setError(bad); return; }
    setPhase("uploading"); setProgress(0);
    try {
      const edits = { title: r.title.trim() || defaultTitle(), trimStartMs: r.trim.start, trimEndMs: r.trim.end === D ? null : r.trim.end, cutStartMs: r.trim.cut?.[0] ?? null, cutEndMs: r.trim.cut?.[1] ?? null, muted: r.muted };
      const id = await uploadRecording({ ...r.rec, title: edits.title, edits }, setProgress);
      setReview(null);
      nav(`/v/${id}`, { state: { justRecorded: true } });
    } catch (e: any) {
      setError(`Upload failed: ${e?.message ?? e}. Your recording is still here; try Save again.`); setPhase("review");
    }
  };
  const discardReview = () => { setReview(null); setConfirmDiscard(false); setPhase("setup"); setElapsed(0); };
  const cancel = () => { session.current?.discard(); session.current = null; closePip(); setPhase("setup"); setElapsed(0); };
  const togglePause = () => { const s = session.current!; if (s.state === "recording") { s.pause(); setPaused(true); } else { s.resume(); setPaused(false); } setElapsed(s.elapsed()); };
  const restart = () => { session.current!.restart(); setPaused(false); setElapsed(0); };

  const live = phase === "recording" || phase === "countdown";
  const remaining = LIMITS.maxRecordingMs - elapsed;
  return (
    <div className="page recorder-page">
      <TopBar />
      <main className="recorder">
        {(phase === "review" || (phase === "uploading" && review)) && review ? (
          <ReviewStep review={review} setReview={setReview} surface={surface} busy={phase === "uploading"} progress={progress} error={error}
            onSave={save} onRedo={() => setConfirmDiscard(true)} />
        ) : <>
        <Stage mode={mode} camera={camera} bubble={bubble} setBubble={setBubble} session={live ? session.current : null}>
          {phase === "countdown" && <button className="countdown" onClick={() => setCount(0)} aria-label="Skip countdown"><span key={count}>{count}</span><small>Click to start now</small></button>}
        </Stage>
        {phase === "finishing" && <div className="upload-card" role="status"><div className="spinner" /><div><strong>Finishing your recording…</strong></div></div>}
        {phase === "uploading" && (
          <div className="upload-card" role="status">
            <div className="spinner" />
            <div><strong>{progress < 1 ? "Uploading your video…" : "Opening your video…"}</strong><div className="progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div><small className="muted">{Math.round(progress * 100)}%</small></div>
          </div>
        )}
        {error && <div className="alert" role="alert">{error}</div>}
        {phase === "recording" ? (
          <div className="rec-bar" role="toolbar" aria-label="Recording controls">
            <span className={`rec-dot ${paused ? "paused" : ""}`} aria-hidden="true" />
            <span className={`rec-time ${remaining < 60_000 ? "warn" : ""}`} data-testid="rec-time">{formatTime(elapsed)}</span>
            <span className="rec-limit muted">/ {formatTime(LIMITS.maxRecordingMs)}</span>
            <span className="rec-sep" />
            <button className="icon-btn" onClick={togglePause} aria-label={paused ? "Resume" : "Pause"} title={paused ? "Resume" : "Pause"}>{paused ? <IconPlay size={18} /> : <IconPause size={18} />}</button>
            <button className="icon-btn" onClick={restart} aria-label="Restart" title="Restart"><IconRestart size={18} /></button>
            <button className="icon-btn" onClick={cancel} aria-label="Cancel recording" title="Cancel"><IconTrash size={18} /></button>
            {pipSupported() && !pip && mode !== "camera" && <button className="icon-btn" onClick={openPip} aria-label="Pop out controls" title="Pop out controls (always on top)"><IconPopOut size={18} /></button>}
            <button className="btn btn-rec" onClick={finish}><IconStop size={16} /> Finish</button>
          </div>
        ) : phase !== "uploading" && phase !== "finishing" && (
          <div className="rec-setup">
            <div className="seg seg-modes" role="radiogroup" aria-label="What to record">
              {MODE_INFO.map(({ mode: m, label, Icon }) => {
                const disabled = m !== "camera" && !screenOk;
                return <button key={m} role="radio" aria-checked={mode === m} disabled={disabled || phase !== "setup"} onClick={() => setMode(m)}><Icon size={18} /> {label}</button>;
              })}
            </div>
            <div className="rec-options">
              <button className={`chip ${mic ? "on" : ""}`} aria-pressed={mic} onClick={() => setMic(!mic)}>{mic ? <IconMic size={16} /> : <IconMicOff size={16} />} {mic ? "Microphone on" : "Microphone off"}</button>
              {mode === "screen_camera" && (
                <div className="seg seg-small" role="radiogroup" aria-label="Bubble size">
                  {(["sm", "md", "lg"] as BubbleSize[]).map(sz => <button key={sz} role="radio" aria-checked={bubble.size === sz} onClick={() => setBubble({ ...bubble, size: sz })}>{sz === "sm" ? "S" : sz === "md" ? "M" : "L"}</button>)}
                </div>
              )}
              <label className="switch"><input type="checkbox" checked={countdownOn} onChange={e => setCountdownOn(e.target.checked)} /><span /> Countdown</label>
            </div>
            {!screenOk && <p className="muted small" data-testid="no-screen-note">Phones and tablets can't share their screen from a browser, so this device records with its camera.</p>}
            <button className="btn btn-rec btn-lg" onClick={start} disabled={phase !== "setup" || (needsCamera && !camera)}><span className="rec-dot" aria-hidden="true" /> Start recording</button>
            <p className="muted small">Up to {LIMITS.maxRecordingMs / 60000} minutes. {mode !== "camera" ? "You'll pick a screen, window or tab next. You can trim the start and end before saving." : "You can trim it before saving."}</p>
          </div>
        )}
        </>}
      </main>
      {confirmDiscard && <Confirm title="Discard this recording?" body="It hasn't been saved, so it will be gone for good." confirm="Discard" onConfirm={discardReview} onCancel={() => setConfirmDiscard(false)} />}
      {pip && (phase === "countdown" || phase === "recording") && createPortal(
        <div className="pip-controls" role="toolbar" aria-label="Recording controls">
          {phase === "countdown" ? <><span className="pip-count" key={count}>{count}</span><span className="pip-label">Recording starts…</span><button className="pip-btn" onClick={() => setCount(0)}>Start now</button><button className="pip-btn" onClick={cancel}>Cancel</button></>
            : <><span className={`rec-dot ${paused ? "paused" : ""}`} /><span className="pip-time">{formatTime(elapsed)}</span>
              <button className="pip-btn" onClick={togglePause} title="Alt+Shift+P">{paused ? "Resume" : "Pause"}</button>
              <button className="pip-btn" onClick={cancel} aria-label="Cancel recording">Cancel</button>
              <button className="pip-btn stop" onClick={finish} title="Alt+Shift+S">■ Stop</button></>}
        </div>, pip.document.body)}
    </div>
  );
}

/** Copies this page's styles into the floating controls window. */
function copyStyles(w: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try { const st = w.document.createElement("style"); st.textContent = Array.from(sheet.cssRules).map(r => r.cssText).join("\n"); w.document.head.appendChild(st); }
    catch { if ((sheet as CSSStyleSheet).href) { const l = w.document.createElement("link"); l.rel = "stylesheet"; l.href = (sheet as CSSStyleSheet).href!; w.document.head.appendChild(l); } }
  }
  w.document.body.className = "pip-body";
  w.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? "";
}

/** After Stop: preview, trim, remove a section, title, mute; then Save (upload) or discard. */
function ReviewStep({ review, setReview, surface, busy, progress, error, onSave, onRedo }: { review: Review; setReview: (r: Review) => void; surface: string; busy: boolean; progress: number; error: string | null; onSave: () => void; onRedo: () => void }) {
  const r = review;
  return (
    <section className="review" aria-label="Review your recording">
      <div className="review-head">
        <div><h1>Review your recording</h1><p className="muted">Nothing is uploaded until you save. {surface === "monitor" ? "You shared a whole screen, so the start and end may show this page: drag the handles to cut them." : "Drag the handles to cut the start or end."}</p></div>
      </div>
      <div className="review-body">
        <TrimEditor src={r.url} poster={r.poster} durationMs={r.rec.durationMs} value={r.trim} onChange={trim => setReview({ ...r, trim })} muted={r.muted} />
        <div className="review-side">
          <label className="field"><span>Title</span><input value={r.title} onChange={e => setReview({ ...r, title: e.target.value })} maxLength={LIMITS.titleChars} aria-label="Title" disabled={busy} /></label>
          <label className="switch"><input type="checkbox" checked={r.muted} onChange={e => setReview({ ...r, muted: e.target.checked })} disabled={busy} /><span /> Mute audio</label>
          <small className="muted">Trim, removed section and mute apply when people watch the link. The stored file is the full recording, and you can change these later. Downloads of muted videos are only for you.</small>
          {error && <div className="alert" role="alert">{error}</div>}
          {busy ? (
            <div className="upload-card inline" role="status"><div className="spinner" /><div><strong>{progress < 1 ? "Uploading your video…" : "Opening your video…"}</strong><div className="progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div><small className="muted">{Math.round(progress * 100)}%</small></div></div>
          ) : (
            <div className="review-actions">
              <button className="btn btn-primary btn-lg" onClick={onSave}>Save video</button>
              <button className="btn btn-ghost" onClick={onRedo}>Discard and record again</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function useSize(ref: React.RefObject<HTMLElement>) {
  const [s, setS] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setS({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return s;
}

function Stage({ mode, camera, bubble, setBubble, session, children }: { mode: Mode; camera: MediaStream | null; bubble: Bubble; setBubble: (b: Bubble) => void; session: RecordingSession | null; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const outRef = useRef<HTMLVideoElement>(null);
  const output = session?.output ?? null;
  // Callback ref: attaches the camera whenever a preview element mounts.
  const camAttach = (v: HTMLVideoElement | null) => { if (v && v.srcObject !== camera) v.srcObject = camera; };
  useEffect(() => { if (outRef.current) outRef.current.srcObject = output ? new MediaStream(output.getVideoTracks()) : null; }, [output]);
  const ar = output && session ? session.width / session.height : 16 / 9;
  const showBubble = mode === "screen_camera";
  const c = clampBubble(bubble, w || 16, h || 9);
  const d = BUBBLE_DIAMETER[bubble.size] * Math.min(w, h);
  const drag = (e: React.PointerEvent) => {
    const el = ref.current!; const r = el.getBoundingClientRect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const dx = e.clientX - (r.left + c.x * r.width), dy = e.clientY - (r.top + c.y * r.height);
    const move = (ev: PointerEvent) => setBubble(clampBubble({ ...bubble, x: (ev.clientX - dx - r.left) / r.width, y: (ev.clientY - dy - r.top) / r.height }, r.width, r.height));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  return (
    <div className="stage" ref={ref} style={{ aspectRatio: String(ar), width: `min(100%, calc(64vh * ${ar.toFixed(4)}))` }} data-testid="stage">
      {output ? <video ref={outRef} className={`stage-video ${mode === "camera" ? "mirror" : ""}`} autoPlay muted playsInline data-testid="live-preview" />
        : mode === "camera" ? <video ref={camAttach} className="stage-video mirror" autoPlay muted playsInline />
        : <div className="stage-placeholder"><div className="ph-window"><div className="hm-bar"><i /><i /><i /></div><div className="ph-lines"><b /><b /><b className="short" /></div></div><p>Your screen appears here once you choose it</p></div>}
      {showBubble && w > 0 && (
        <div className={`bubble ${output ? "ghost" : ""}`} onPointerDown={drag} style={{ width: d, height: d, left: c.x * w - d / 2, top: c.y * h - d / 2 }} title="Drag to move" aria-label="Camera bubble. Drag to move" data-testid="bubble">
          {!output && <video ref={camAttach} autoPlay muted playsInline className="mirror" />}
        </div>
      )}
      {children}
    </div>
  );
}
