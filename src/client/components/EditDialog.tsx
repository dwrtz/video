import { useRef, useState } from "react";
import { api } from "../lib/api";
import { chaptersToText, keepsAll, parseChapters, removedSpans, validCut, validTrim } from "../../shared/time";
import { TrimEditor, toEdits, type TrimValue } from "./TrimEditor";
import { downloadMedia, replaceVideo } from "../lib/upload";
import { exportCut, isAbort, thumbnailOf } from "../lib/exporter";
import type { VideoDetail } from "../../shared/types";
import { Modal } from "./ui";

type Stage = "downloading" | "cutting" | "uploading";
const STAGE_TEXT: Record<Stage, string> = { downloading: "Downloading the video…", cutting: "Cutting your video…", uploading: "Uploading the cut video…" };

export function EditDialog({ video, onClose, onSaved }: { video: VideoDetail; onClose: () => void; onSaved: () => void }) {
  const D = video.durationMs;
  const [title, setTitle] = useState(video.title);
  const [trim, setTrim] = useState<TrimValue>({ start: 0, end: D, cut: null });
  const [muted, setMuted] = useState(false);
  const [chapters, setChapters] = useState(chaptersToText(video.chapters));
  const [allowComments, setAllowComments] = useState(video.allowComments);
  const [allowDownload, setAllowDownload] = useState(video.allowDownload);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [progress, setProgress] = useState(0);
  const ctl = useRef<AbortController | null>(null);
  const edits = toEdits(D, trim);
  const needsCut = !keepsAll(edits) || muted;

  const check = () => {
    const p = parseChapters(chapters, D);
    if ("error" in p) { setErr(p.error); return null; }
    const t = validTrim(D, trim.start, trim.end) ?? validCut(edits);
    if (t) { setErr(t); return null; }
    return p.chapters;
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!check()) return;
    if (needsCut) setConfirming(true); else run();
  };
  const run = async () => {
    const ch = check(); if (!ch) { setConfirming(false); return; }
    setBusy(true); setErr(null);
    let now: Stage | null = null;
    try {
      await api(`/api/videos/${video.id}`, { method: "PATCH", body: { title, chapters: ch, allowComments, allowDownload } });
      if (needsCut) {
        const ac = new AbortController(); ctl.current = ac;
        now = "downloading"; setStage(now); setProgress(0);
        const original = await downloadMedia(video.id, setProgress, ac.signal);
        now = "cutting"; setStage(now); setProgress(0);
        const out = await exportCut(original, { edits, muted, onProgress: setProgress, signal: ac.signal });
        (window as any).__videoExport = { method: out.method, keptMs: out.durationMs, bytes: out.blob.size };
        const thumbnail = await thumbnailOf(out.blob);
        now = "uploading"; setStage(now); setProgress(0);
        await replaceVideo(video.id, { ...out, thumbnail }, removedSpans(edits), setProgress, ac.signal);
      }
      onSaved();
    } catch (e) {
      ctl.current = null; setStage(null); setBusy(false); setConfirming(false);
      if (isAbort(e)) { setErr("Cancelled. The video wasn't changed (the title, chapters and switches were saved)."); return; }
      setErr(`${now ? "Couldn't cut the video" : "Couldn't save"}: ${e instanceof Error ? e.message : e}. The video wasn't changed.`);
    }
  };

  if (confirming) return (
    <Modal title="Cut this video for good?" onClose={busy ? () => {} : () => setConfirming(false)}>
      <div className="edit" data-testid="cut-confirm">
        <p>Saving makes a new copy with only the kept part{muted ? " and no sound" : ""}, then deletes the old file. <strong>This can't be undone.</strong></p>
        <p className="muted small">Comments, reactions and chapters move with the video. In the removed parts, comments lose their time, and reactions and chapters are deleted.</p>
        {stage ? (
          <div className="upload-card inline" role="status" data-testid="save-progress">
            <div className="spinner" />
            <div><strong>{STAGE_TEXT[stage]}</strong><div className="progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div><small className="muted">{Math.round(progress * 100)}%</small></div>
            <button className="btn btn-ghost btn-sm" onClick={() => ctl.current?.abort()}>Cancel</button>
          </div>
        ) : (
          <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Back</button><button className="btn btn-danger" onClick={run} disabled={busy}>Cut and save</button></div>
        )}
      </div>
    </Modal>
  );
  return (
    <Modal title="Edit video" onClose={onClose} wide>
      <form onSubmit={submit} className="edit">
        <label className="field"><span>Title</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} /></label>
        <div className="field">
          <span>Cut</span>
          <TrimEditor src={`/api/videos/${video.id}/media`} poster={video.hasThumbnail ? `/api/videos/${video.id}/thumbnail` : undefined} durationMs={D} value={trim} onChange={setTrim} muted />
          <small className="muted">Cutting makes a new copy of the video with only the kept part and deletes the old one. It can't be undone.</small>
        </div>
        <label className="field"><span>Chapters</span>
          <textarea rows={4} value={chapters} onChange={e => setChapters(e.target.value)} placeholder={"0:00 Intro\n0:45 The new flow\n2:10 Next steps"} aria-label="Chapters" />
          <small className="muted">One per line: a time in the video above, then a title. Chapters inside a cut part are dropped.</small>
        </label>
        <div className="toggles">
          <label className="switch"><input type="checkbox" checked={allowComments} onChange={e => setAllowComments(e.target.checked)} /><span /> Allow comments</label>
          <label className="switch"><input type="checkbox" checked={muted} onChange={e => setMuted(e.target.checked)} /><span /> Mute audio</label>
          <label className="switch"><input type="checkbox" checked={allowDownload} onChange={e => setAllowDownload(e.target.checked)} /><span /> Allow downloads</label>
        </div>
        {err && <div className="alert" role="alert">{err}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{needsCut ? "Save…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}
