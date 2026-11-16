import { useState } from "react";
import { api } from "../lib/api";
import { chaptersToText, parseChapters, trimWindow, validCut, validTrim } from "../../shared/time";
import { TrimEditor, toEdits, type TrimValue } from "./TrimEditor";
import type { VideoDetail } from "../../shared/types";
import { Modal } from "./ui";

export function EditDialog({ video, onClose, onSaved }: { video: VideoDetail; onClose: () => void; onSaved: () => void }) {
  const win = trimWindow(video);
  const [title, setTitle] = useState(video.title);
  const [trim, setTrim] = useState<TrimValue>({ start: win.start, end: win.end, cut: video.cutStartMs != null && video.cutEndMs != null ? [video.cutStartMs, video.cutEndMs] : null });
  const [muted, setMuted] = useState(video.muted);
  const [chapters, setChapters] = useState(chaptersToText(video.chapters));
  const [allowComments, setAllowComments] = useState(video.allowComments);
  const [allowDownload, setAllowDownload] = useState(video.allowDownload);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const D = video.durationMs;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const p = parseChapters(chapters, D);
    if ("error" in p) { setErr(p.error); return; }
    const t = validTrim(D, trim.start, trim.end) ?? validCut(toEdits(D, trim));
    if (t) { setErr(t); return; }
    setBusy(true);
    try { await api(`/api/videos/${video.id}`, { method: "PATCH", body: { title, trimStartMs: trim.start, trimEndMs: trim.end, cutStartMs: trim.cut?.[0] ?? null, cutEndMs: trim.cut?.[1] ?? null, muted, chapters: p.chapters, allowComments, allowDownload } }); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); setBusy(false); }
  };
  return (
    <Modal title="Edit video" onClose={onClose} wide>
      <form onSubmit={save} className="edit">
        <label className="field"><span>Title</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} /></label>
        <div className="field">
          <span>Trim</span>
          <TrimEditor src={`/api/videos/${video.id}/media`} poster={video.hasThumbnail ? `/api/videos/${video.id}/thumbnail` : undefined} durationMs={D} value={trim} onChange={setTrim} muted />
          <small className="muted">Viewers only see the kept part. The original file stays intact, so you can change this later. Downloads are the full original recording.</small>
        </div>
        <label className="field"><span>Chapters</span>
          <textarea rows={4} value={chapters} onChange={e => setChapters(e.target.value)} placeholder={"0:00 Intro\n0:45 The new flow\n2:10 Next steps"} aria-label="Chapters" />
          <small className="muted">One per line: a time in the original recording, then a title.</small>
        </label>
        <div className="toggles">
          <label className="switch"><input type="checkbox" checked={allowComments} onChange={e => setAllowComments(e.target.checked)} /><span /> Allow comments</label>
          <label className="switch"><input type="checkbox" checked={muted} onChange={e => setMuted(e.target.checked)} /><span /> Mute audio</label>
          <label className="switch"><input type="checkbox" checked={allowDownload} onChange={e => setAllowDownload(e.target.checked)} /><span /> Allow downloads</label>
        </div>
        {err && <div className="alert" role="alert">{err}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
