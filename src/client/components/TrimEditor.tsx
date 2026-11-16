import { useEffect, useRef, useState } from "react";
import { formatTime, keptLength, nextPlayable, segments, type Edits } from "../../shared/time";
import { IconPause, IconPlay } from "./Icons";

export type TrimValue = { start: number; end: number; cut: [number, number] | null };
export const toEdits = (durationMs: number, v: TrimValue): Edits => ({ durationMs, trimStartMs: v.start, trimEndMs: v.end, cutStartMs: v.cut?.[0] ?? null, cutEndMs: v.cut?.[1] ?? null });
const STEP = 100, MIN_KEEP = 1000, MIN_CUT = 500;

/**
 * Trim handles (in and out) plus one optional removed section, on top of a preview that plays only
 * the kept parts. Used before saving a recording and in the Edit dialog. Never changes the file.
 */
export function TrimEditor({ src, poster, durationMs, value, onChange, muted }: { src: string; poster?: string; durationMs: number; value: TrimValue; onChange: (v: TrimValue) => void; muted?: boolean }) {
  const D = Math.max(1, durationMs);
  const el = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState(value.start);
  const edits = toEdits(D, value);
  const segs = segments(edits);
  const lastEnd = segs[segs.length - 1][1];
  const show = (ms: number) => { const v = el.current; if (v) { v.pause(); v.currentTime = ms / 1000; setHead(ms); } };

  // Keep preview playback inside the kept parts, frame by frame where the browser allows.
  useEffect(() => {
    const v = el.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void }) | null;
    if (!v || !playing) return;
    let h = 0, raf = 0;
    const tick = () => {
      const ms = v.currentTime * 1000; setHead(ms);
      if (ms >= lastEnd - 20) { v.pause(); v.currentTime = lastEnd / 1000; return; }
      const n = nextPlayable(edits, ms);
      if (n !== null && n - ms > 30) v.currentTime = n / 1000;
      if (v.requestVideoFrameCallback) h = v.requestVideoFrameCallback(tick); else raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { v.cancelVideoFrameCallback?.(h); cancelAnimationFrame(raf); };
  }, [playing, value.start, value.end, value.cut?.[0], value.cut?.[1]]);

  const playSelection = () => {
    const v = el.current!; if (!v.paused) { v.pause(); return; }
    const ms = v.currentTime * 1000;
    const from = ms >= lastEnd - 50 || ms < value.start ? value.start : (nextPlayable(edits, ms) ?? value.start);
    v.currentTime = from / 1000; v.play().catch(() => {});
  };
  const setStart = (x: number) => { const lim = (value.cut ? value.cut[0] : value.end) - (value.cut ? 100 : MIN_KEEP); const s = Math.max(0, Math.min(x, lim)); onChange({ ...value, start: s }); show(s); };
  const setEnd = (x: number) => { const lim = (value.cut ? value.cut[1] : value.start) + (value.cut ? 100 : MIN_KEEP); const e = Math.min(D, Math.max(x, lim)); onChange({ ...value, end: e }); show(e); };
  const setCutA = (x: number) => { const c = value.cut!; const a = Math.max(value.start + 100, Math.min(x, c[1] - MIN_CUT)); onChange({ ...value, cut: [a, c[1]] }); show(a); };
  const setCutB = (x: number) => { const c = value.cut!; const b = Math.min(value.end - 100, Math.max(x, c[0] + MIN_CUT)); onChange({ ...value, cut: [c[0], b] }); show(b); };
  const addCut = () => {
    const len = value.end - value.start;
    const w = Math.max(MIN_CUT, Math.min(3000, Math.round(len * 0.2 / STEP) * STEP));
    if (len - w < MIN_KEEP + 200) return;
    const mid = Math.min(Math.max(head, value.start + 100 + w / 2), value.end - 100 - w / 2);
    const a = Math.round((mid - w / 2) / STEP) * STEP;
    onChange({ ...value, cut: [a, a + w] }); show(a);
  };
  const pct = (ms: number) => `${(ms / D) * 100}%`;
  const canCut = value.end - value.start >= MIN_KEEP + MIN_CUT + 400;
  const keptMs = keptLength(edits);

  return (
    <div className="trim-editor">
      <div className="trim-stage">
        <video ref={el} className="trim-preview" src={src} poster={poster} preload="auto" playsInline muted={muted}
          onLoadedMetadata={() => show(value.start + 50)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} data-testid="trim-video" />
        <button type="button" className="trim-play" onClick={playSelection} aria-label={playing ? "Pause preview" : "Play the kept part"}>{playing ? <IconPause size={18} /> : <IconPlay size={18} />}</button>
      </div>
      <div className={`trim ${value.cut ? "has-cut" : ""}`}>
        <div className="trim-fill" style={{ left: pct(value.start), right: `${100 - (value.end / D) * 100}%` }} />
        {value.cut && <div className="trim-cut" style={{ left: pct(value.cut[0]), width: pct(value.cut[1] - value.cut[0]) }} />}
        <div className="trim-head" style={{ left: pct(Math.min(Math.max(head, 0), D)) }} aria-hidden="true" />
        <input type="range" min={0} max={D} step={STEP} value={value.start} aria-label="Trim start" aria-valuetext={formatTime(value.start)} onChange={e => setStart(Number(e.target.value))} />
        <input type="range" min={0} max={D} step={STEP} value={value.end} aria-label="Trim end" aria-valuetext={formatTime(value.end)} onChange={e => setEnd(Number(e.target.value))} />
        {value.cut && <>
          <input className="cut-thumb" type="range" min={0} max={D} step={STEP} value={value.cut[0]} aria-label="Remove from" aria-valuetext={formatTime(value.cut[0])} onChange={e => setCutA(Number(e.target.value))} />
          <input className="cut-thumb" type="range" min={0} max={D} step={STEP} value={value.cut[1]} aria-label="Remove to" aria-valuetext={formatTime(value.cut[1])} onChange={e => setCutB(Number(e.target.value))} />
        </>}
      </div>
      <div className="trim-labels"><span>Start {formatTime(value.start)}</span><strong data-testid="kept">{formatTime(keptMs)} kept</strong><span>End {formatTime(value.end)}</span></div>
      <div className="trim-actions">
        {value.cut
          ? <><span className="cut-label">Removing {formatTime(value.cut[0])}–{formatTime(value.cut[1])}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...value, cut: null })}>Keep that part</button></>
          : <button type="button" className="btn btn-ghost btn-sm" onClick={addCut} disabled={!canCut}>Remove a section…</button>}
        {(value.start > 0 || value.end < D || value.cut) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange({ start: 0, end: D, cut: null }); show(0); }}>Reset</button>}
      </div>
    </div>
  );
}
