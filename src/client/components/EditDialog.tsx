import { useRef, useState } from "react";
import { api } from "../lib/api";
import { chaptersToText, formatTime, parseChapters, trimWindow, validTrim } from "../../shared/time";
import type { VideoDetail } from "../../shared/types";
import { Modal } from "./ui";

export function EditDialog({ video, onClose, onSaved }: { video: VideoDetail; onClose: () => void; onSaved: () => void }) {
  const win = trimWindow(video);
  const [title, setTitle] = useState(video.title);
  const [start, setStart] = useState(win.start);
  const [end, setEnd] = useState(win.end);
  const [chapters, setChapters] = useState(chaptersToText(video.chapters));
  const [allowComments, setAllowComments] = useState(video.allowComments);
  const [allowDownload, setAllowDownload] = useState(video.allowDownload);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLVideoElement>(null);
  const D = video.durationMs;
  const show = (ms: number) => { if (preview.current) preview.current.currentTime = ms / 1000; };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const p = parseChapters(chapters, D);
    if ("error" in p) { setErr(p.error); return; }
    const t = validTrim(D, start, end);
    if (t) { setErr(t); return; }
    setBusy(true);
    try { await api(`/api/videos/${video.id}`, { method: "PATCH", body: { title, trimStartMs: start, trimEndMs: end, chapters: p.chapters, allowComments, allowDownload } }); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); setBusy(false); }
  };
  return (
    <Modal title="Edit video" onClose={onClose} wide>
      <form onSubmit={save} className="edit">
        <label className="field"><span>Title</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} /></label>
        <div className="field">
          <span>Trim</span>
          <video ref={preview} className="trim-preview" src={`/api/videos/${video.id}/media`} poster={video.hasThumbnail ? `/api/videos/${video.id}/thumbnail` : undefined} preload="auto" muted playsInline onLoadedMetadata={() => show(start)} />
          <div className="trim">
            <div className="trim-fill" style={{ left: `${(start / D) * 100}%`, right: `${100 - (end / D) * 100}%` }} />
            <input type="range" min={0} max={D} step={100} value={start} aria-label="Trim start" onChange={e => { const v = Math.min(Number(e.target.value), end - 1000); setStart(Math.max(0, v)); show(v); }} />
            <input type="range" min={0} max={D} step={100} value={end} aria-label="Trim end" onChange={e => { const v = Math.max(Number(e.target.value), start + 1000); setEnd(Math.min(D, v)); show(v); }} />
          </div>
          <div className="trim-labels"><span>Start {formatTime(start)}</span><strong>{formatTime(end - start)} kept</strong><span>End {formatTime(end)}</span></div>
          <small className="muted">Viewers only see the part between the handles. The original stays intact, so you can widen it again later.</small>
        </div>
        <label className="field"><span>Chapters</span>
          <textarea rows={4} value={chapters} onChange={e => setChapters(e.target.value)} placeholder={"0:00 Intro\n0:45 The new flow\n2:10 Next steps"} aria-label="Chapters" />
          <small className="muted">One per line: a time in the original recording, then a title.</small>
        </label>
        <div className="toggles">
          <label className="switch"><input type="checkbox" checked={allowComments} onChange={e => setAllowComments(e.target.checked)} /><span /> Allow comments</label>
          <label className="switch"><input type="checkbox" checked={allowDownload} onChange={e => setAllowDownload(e.target.checked)} /><span /> Allow downloads</label>
        </div>
        {err && <div className="alert" role="alert">{err}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
