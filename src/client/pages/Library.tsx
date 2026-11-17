import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TopBar } from "../App";
import { api, copyText, relativeDate, shareUrl } from "../lib/api";
import { formatTime } from "../../shared/time";
import type { VideoSummary } from "../../shared/types";
import { IconComment, IconEye, IconLink, IconMore, IconPlus, IconSearch, IconTrash, IconEdit, IconScreenCam, IconCamera, IconScreen } from "../components/Icons";
import { Confirm, Toast, useToast } from "../components/ui";

export function LibraryPage() {
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [toDelete, setToDelete] = useState<VideoSummary | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const toast = useToast();
  const nav = useNavigate();
  const load = () => api<{ videos: VideoSummary[] }>("/api/videos").then(r => setVideos(r.videos));
  useEffect(() => { load(); }, []);
  const shown = useMemo(() => (videos ?? []).filter(v => v.title.toLowerCase().includes(q.trim().toLowerCase())), [videos, q]);
  const totalMs = (videos ?? []).reduce((a, v) => a + v.durationMs, 0);
  return (
    <div className="page">
      <TopBar />
      <main className="library">
        <div className="library-head">
          <div>
            <h1>My videos</h1>
            {videos && <p className="muted">{videos.length} video{videos.length === 1 ? "" : "s"} · {formatTime(totalMs)} recorded</p>}
          </div>
          <div className="library-actions">
            <label className="search"><IconSearch size={17} /><input type="search" placeholder="Search videos" aria-label="Search videos" value={q} onChange={e => setQ(e.target.value)} /></label>
            <Link className="btn btn-primary" to="/record"><IconPlus size={18} /> New video</Link>
          </div>
        </div>
        {videos === null ? <div className="grid">{[0, 1, 2].map(i => <div key={i} className="card skeleton" />)}</div>
          : videos.length === 0 ? (
            <div className="empty">
              <div className="empty-art"><IconScreenCam size={40} /></div>
              <h2>Record your first video</h2>
              <p className="muted">Show your screen, add your face in a bubble, and share a link. Viewers can react and comment at any moment.</p>
              <Link className="btn btn-primary btn-lg" to="/record"><IconPlus size={18} /> New video</Link>
            </div>
          ) : shown.length === 0 ? <p className="muted no-results">No videos match “{q}”.</p> : (
            <ul className="grid" aria-label="Videos">
              {shown.map(v => <VideoCard key={v.id} v={v} renaming={renaming === v.id}
                onOpen={() => nav(`/v/${v.id}`)}
                onCopy={async () => toast.show((await copyText(shareUrl(v.id))) ? "Link copied" : shareUrl(v.id))}
                onRename={() => setRenaming(v.id)}
                onRenamed={async t => { setRenaming(null); if (t && t !== v.title) { await api(`/api/videos/${v.id}`, { method: "PATCH", body: { title: t } }); load(); } }}
                onDelete={() => setToDelete(v)} />)}
            </ul>
          )}
      </main>
      {toDelete && <Confirm title="Delete this video?" body={`“${toDelete.title}” and its comments and reactions will be deleted for everyone. This can't be undone.`} confirm="Delete"
        onCancel={() => setToDelete(null)} onConfirm={async () => { await api(`/api/videos/${toDelete.id}`, { method: "DELETE" }); setToDelete(null); toast.show("Video deleted"); load(); }} />}
      <Toast {...toast} />
    </div>
  );
}

function VideoCard({ v, renaming, onOpen, onCopy, onRename, onRenamed, onDelete }: { v: VideoSummary; renaming: boolean; onOpen: () => void; onCopy: () => void; onRename: () => void; onRenamed: (t: string) => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const ModeIcon = v.mode === "camera" ? IconCamera : v.mode === "screen" ? IconScreen : IconScreenCam;
  return (
    <li className="card" data-testid="video-card">
      <button className="thumb" onClick={onOpen} aria-label={`Open ${v.title}`}>
        {v.hasThumbnail ? <img src={`/api/videos/${v.id}/thumbnail`} alt="" loading="lazy" /> : <span className="thumb-blank"><ModeIcon size={28} /></span>}
        <span className="duration">{formatTime(v.durationMs)}</span>
      </button>
      <div className="card-body">
        {renaming ? (
          <input className="rename" autoFocus defaultValue={v.title} aria-label="Video title" onBlur={e => onRenamed(e.target.value.trim())} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") onRenamed(""); }} />
        ) : <Link to={`/v/${v.id}`} className="card-title">{v.title}</Link>}
        <div className="card-meta">
          <span>{relativeDate(v.createdAt)}</span>
          <span className="stat" title="Views"><IconEye size={15} /> {v.viewCount}</span>
          <span className="stat" title="Comments"><IconComment size={15} /> {v.commentCount}</span>
        </div>
      </div>
      <div className="card-menu menu-wrap">
        <button className="icon-btn" aria-label={`More actions for ${v.title}`} aria-expanded={menu} onClick={() => setMenu(m => !m)}><IconMore size={18} /></button>
        {menu && (
          <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
            <button role="menuitem" onClick={() => { setMenu(false); onCopy(); }}><IconLink size={16} /> Copy link</button>
            <button role="menuitem" onClick={() => { setMenu(false); onRename(); }}><IconEdit size={16} /> Rename</button>
            <button role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(); }}><IconTrash size={16} /> Delete</button>
          </div>
        )}
      </div>
    </li>
  );
}
