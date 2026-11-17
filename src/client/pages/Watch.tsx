import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { TopBar, Avatar, useAuth } from "../App";
import { api, ApiError, copyText, relativeDate, shareUrl } from "../lib/api";
import { LIMITS, REACTIONS } from "../../shared/limits";
import { chapterAt, formatTime } from "../../shared/time";
import type { Comment, Reaction, VideoDetail } from "../../shared/types";
import { Player, type PlayerHandle } from "../components/Player";
import { EditDialog } from "../components/EditDialog";
import { Confirm, Toast, useToast } from "../components/ui";
import { IconChapters, IconComment, IconDownload, IconEdit, IconEye, IconLink, IconTrash, IconClock } from "../components/Icons";

export function WatchPage() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [tab, setTab] = useState<"comments" | "chapters">("comments");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const player = useRef<PlayerHandle>(null);
  const toast = useToast();
  const composer = useRef<HTMLTextAreaElement>(null);

  const load = () => api<{ video: VideoDetail }>(`/api/videos/${id}`).then(r => { setVideo(r.video); setReactions(r.video.reactions); document.title = r.video.title; })
    .catch(e => { if (e instanceof ApiError && e.status === 404) setMissing(true); });
  const loadComments = () => api<{ comments: Comment[] }>(`/api/videos/${id}/comments`).then(r => setComments(r.comments)).catch(() => {});
  useEffect(() => { load(); loadComments(); const t = setInterval(loadComments, 15000); return () => clearInterval(t); }, [id, me?.id]);
  useEffect(() => { if ((loc.state as any)?.justRecorded && video) toast.show("Your video is ready. Copy the link to share it."); }, [video?.id]);

  if (missing) return <div className="page"><TopBar /><main className="empty-page"><h1>Video not found</h1><p className="muted">The link may be wrong, or the video was deleted.</p><Link className="btn btn-primary" to="/">Go home</Link></main></div>;
  if (!video) return <div className="page"><TopBar /><main className="watch"><div className="watch-main"><div className="player skeleton" /></div></main></div>;

  // ?t=90 starts at 1:30.
  const tParam = new URLSearchParams(loc.search).get("t");
  const startAtMs = tParam && /^\d+$/.test(tParam) ? Number(tParam) * 1000 : undefined;
  const react = async (emoji: string) => {
    const timeMs = Math.min(Math.max(player.current?.time() ?? 0, 0), video.durationMs);
    player.current?.burst(emoji);
    try { const r = await api<{ reaction: Reaction }>(`/api/videos/${id}/reactions`, { method: "POST", body: { emoji, timeMs } }); setReactions(rs => [...rs, r.reaction].sort((a, b) => a.timeMs - b.timeMs)); }
    catch (e) { toast.show(e instanceof Error ? e.message : "Couldn't react"); }
  };
  const counts = REACTIONS.map(e => [e, reactions.filter(r => r.emoji === e).length] as const);
  return (
    <div className="page">
      <TopBar>{me && <Link className="btn btn-ghost hide-sm" to="/">My videos</Link>}</TopBar>
      <main className="watch">
        <div className="watch-main">
          <div className="watch-head">
            <div className="watch-title">
              {renaming ? <input className="rename big" autoFocus defaultValue={video.title} aria-label="Video title" maxLength={LIMITS.titleChars}
                onBlur={async e => { const t = e.target.value.trim(); setRenaming(false); if (t && t !== video.title) { await api(`/api/videos/${id}`, { method: "PATCH", body: { title: t } }); load(); } }}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(false); }} />
                : <h1 onDoubleClick={() => video.isOwner && setRenaming(true)} data-testid="video-title">{video.title}</h1>}
              <div className="watch-meta">
                <Avatar name={video.ownerName} size={22} /><span className="owner">{video.ownerName}</span><span className="dot">·</span><span>{relativeDate(video.createdAt)}</span>
                <span className="dot">·</span><span className="stat" data-testid="views"><IconEye size={15} /> {video.viewCount} view{video.viewCount === 1 ? "" : "s"}</span>
              </div>
            </div>
            <div className="watch-actions">
              <button className="btn btn-primary" onClick={async () => toast.show((await copyText(shareUrl(id))) ? "Link copied" : shareUrl(id))}><IconLink size={17} /> Copy link</button>
              {(video.allowDownload || video.isOwner) && <a className="icon-btn bordered" href={`/api/videos/${id}/media?download`} aria-label="Download" title="Download"><IconDownload size={18} /></a>}
              {video.isOwner && <>
                <button className="icon-btn bordered" onClick={() => setEditing(true)} aria-label="Edit video" title="Edit (cut, chapters, sharing)"><IconEdit size={18} /></button>
                <button className="icon-btn bordered" onClick={() => setDeleting(true)} aria-label="Delete video" title="Delete"><IconTrash size={18} /></button>
              </>}
            </div>
          </div>
          <Player ref={player} video={video} startAtMs={startAtMs} comments={comments} reactions={reactions} onWatched={() => api<{ viewCount: number }>(`/api/videos/${id}/views`, { method: "POST", body: {} }).then(r => setVideo(v => v && { ...v, viewCount: r.viewCount })).catch(() => {})} />
          <div className="react-bar" role="group" aria-label="React">
            {counts.map(([e, n]) => <button key={e} className="react" onClick={() => react(e)} aria-label={`React ${e}`}><span>{e}</span>{n > 0 && <small>{n}</small>}</button>)}
            {video.allowComments && <><span className="rec-sep" /><button className="btn btn-ghost" onClick={() => { setTab("comments"); setTimeout(() => composer.current?.focus(), 0); }}><IconComment size={17} /> Comment</button></>}
          </div>
        </div>
        <aside className="side">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "comments"} onClick={() => setTab("comments")}><IconComment size={16} /> Comments <span className="count">{comments.length}</span></button>
            <button role="tab" aria-selected={tab === "chapters"} onClick={() => setTab("chapters")}><IconChapters size={16} /> Chapters <span className="count">{video.chapters.length}</span></button>
          </div>
          {tab === "comments"
            ? <Comments video={video} comments={comments} setComments={setComments} player={player} composer={composer} me={me} toast={toast.show} />
            : <Chapters video={video} player={player} onEdit={() => setEditing(true)} />}
        </aside>
      </main>
      {editing && <EditDialog video={video} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); toast.show("Saved"); }} />}
      {deleting && <Confirm title="Delete this video?" body="The video, its comments and reactions will be deleted for everyone, and the link will stop working." confirm="Delete"
        onCancel={() => setDeleting(false)} onConfirm={async () => { await api(`/api/videos/${id}`, { method: "DELETE" }); nav("/"); }} />}
      <Toast {...toast} />
    </div>
  );
}

function Chapters({ video, player, onEdit }: { video: VideoDetail; player: React.RefObject<PlayerHandle>; onEdit: () => void }) {
  const [now, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(player.current?.time() ?? 0), 400); return () => clearInterval(t); }, []);
  const cur = chapterAt(video.chapters, now);
  if (!video.chapters.length) return <div className="side-empty"><IconChapters size={28} /><p>No chapters yet.</p>{video.isOwner && <button className="btn btn-ghost" onClick={onEdit}>Add chapters</button>}</div>;
  return (
    <ol className="chapters">
      {video.chapters.map((c, i) => <li key={i} className={i === cur ? "current" : ""}><button onClick={() => { player.current?.seek(c.timeMs); player.current?.play(); }}><span className="ts">{formatTime(c.timeMs)}</span><span>{c.title}</span></button></li>)}
    </ol>
  );
}

function Comments({ video, comments, setComments, player, composer, me, toast }: { video: VideoDetail; comments: Comment[]; setComments: (c: Comment[]) => void; player: React.RefObject<PlayerHandle>; composer: React.RefObject<HTMLTextAreaElement>; me: { name: string } | null; toast: (m: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem("av.name") ?? "");
  const [text, setText] = useState("");
  const [atTime, setAtTime] = useState(true);
  const [now, setNow] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(player.current?.time() ?? 0), 300); return () => clearInterval(t); }, []);
  const sorted = [...comments].sort((a, b) => (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity) || a.createdAt - b.createdAt);
  const post = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      const r = await api<{ comment: Comment }>(`/api/videos/${video.id}/comments`, { method: "POST", body: { name, body: text, timeMs: atTime ? Math.min(Math.max(now, 0), video.durationMs) : null } });
      if (!me) localStorage.setItem("av.name", name.trim());
      setComments([...comments, r.comment]); setText("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't post"); }
  };
  return (
    <div className="comments">
      <ul className="comment-list" aria-label="Comments">
        {sorted.length === 0 && <li className="side-empty"><IconComment size={28} /><p>No comments yet.</p><small className="muted">Comments are pinned to the moment you post them.</small></li>}
        {sorted.map(c => (
          <li key={c.id} className="comment" data-testid="comment">
            <Avatar name={c.authorName} size={30} />
            <div className="comment-body">
              <div className="comment-head"><strong>{c.authorName}</strong>{c.byOwner && <span className="badge">Author</span>}<span className="muted small">{relativeDate(c.createdAt)}</span></div>
              <p>{c.timeMs !== null && <button className="ts" onClick={() => { player.current?.seek(c.timeMs!); }} aria-label={`Jump to ${formatTime(c.timeMs)}`}>{formatTime(c.timeMs)}</button>}{c.body}</p>
            </div>
            {(c.mine || video.isOwner) && <button className="icon-btn small" aria-label="Delete comment" onClick={async () => { await api(`/api/videos/${video.id}/comments/${c.id}`, { method: "DELETE" }); setComments(comments.filter(x => x.id !== c.id)); toast("Comment deleted"); }}><IconTrash size={15} /></button>}
          </li>
        ))}
      </ul>
      {video.allowComments || video.isOwner ? (
        <form className="composer" onSubmit={post}>
          {!me && <input placeholder="Your name" aria-label="Your name" value={name} maxLength={LIMITS.nameChars} onChange={e => setName(e.target.value)} />}
          <textarea ref={composer} placeholder="Add a comment…" aria-label="Comment" value={text} maxLength={LIMITS.commentChars} rows={2} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(e); }} />
          <div className="composer-row">
            <label className="check"><input type="checkbox" checked={atTime} onChange={e => setAtTime(e.target.checked)} /><IconClock size={15} /> at {formatTime(now)}</label>
            <button className="btn btn-primary btn-sm" disabled={!text.trim() || (!me && !name.trim())}>Post</button>
          </div>
          {err && <div className="alert small" role="alert">{err}</div>}
        </form>
      ) : <p className="muted small comments-off">Comments are turned off for this video.</p>}
    </div>
  );
}
