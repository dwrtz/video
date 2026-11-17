import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { SPEEDS } from "../../shared/limits";
import { atSpeed, chapterAt, formatTime, type Chapter } from "../../shared/time";
import type { Comment, Reaction, VideoDetail } from "../../shared/types";
import { IconBack5, IconDownload, IconFullscreen, IconFwd5, IconMute, IconPause, IconPlay, IconVolume } from "./Icons";

export type PlayerHandle = { seek: (mediaMs: number) => void; time: () => number; play: () => void; burst: (emoji: string) => void };
type Props = { video: VideoDetail; comments: Comment[]; reactions: Reaction[]; onWatched: () => void; startAtMs?: number };

/** Can this browser play the file's format at all? (Old iPhones can't play WebM.) */
export function canPlayFormat(contentType: string): boolean {
  const el = document.createElement("video");
  const base = contentType.split(";")[0];
  return el.canPlayType(base) !== "" || el.canPlayType(base === "video/webm" ? 'video/webm; codecs="vp9, opus"' : 'video/mp4; codecs="avc1.42E01F"') !== "";
}

/** Custom player. The stored file is exactly what viewers see (cuts are made before upload), so times are plain media times. */
export const Player = forwardRef<PlayerHandle, Props>(function Player({ video, comments, reactions, onWatched, startAtMs }, ref) {
  const v = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const dur = Math.max(1, video.durationMs);
  const [t, setT] = useState(0);
  const [unsupported, setUnsupported] = useState(() => !canPlayFormat(video.contentType));
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem("av.speed")) || 1);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speedMenu, setSpeedMenu] = useState(false);
  const [bursts, setBursts] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const [idle, setIdle] = useState(false);
  const watched = useRef({ ms: 0, last: 0, sent: false });

  const clamp = (ms: number) => Math.min(Math.max(ms, 0), dur);
  // A seek before the metadata has loaded (a comment's timestamp clicked early) is kept and applied on loadedmetadata.
  const pendingSeek = useRef<number | null>(null);
  const seek = (ms: number) => { const el = v.current!; const c = clamp(ms); if (el.readyState === 0) pendingSeek.current = c; el.currentTime = c / 1000; setT(c); setEnded(false); };
  const play = () => { const el = v.current!; if (el.ended || el.currentTime * 1000 >= dur - 50) el.currentTime = 0; setStarted(true); el.play().catch(() => {}); };
  const toggle = () => (v.current!.paused ? play() : v.current!.pause());
  useImperativeHandle(ref, () => ({
    seek: ms => { seek(ms); setStarted(true); },
    time: () => Math.round((v.current?.currentTime ?? 0) * 1000),
    play,
    burst: emoji => { const id = Math.random(); setBursts(b => [...b, { id, emoji, x: 10 + Math.random() * 80 }]); setTimeout(() => setBursts(b => b.filter(x => x.id !== id)), 1800); },
  }));

  useEffect(() => { const el = v.current!; el.playbackRate = speed; localStorage.setItem("av.speed", String(speed)); }, [speed]);
  useEffect(() => { const el = v.current!; el.muted = muted; el.volume = volume; }, [muted, volume]);

  // Keyboard shortcuts on the whole page, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = v.current!; const now = el.currentTime * 1000;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") { if (tag === "BUTTON" && k === " ") return; e.preventDefault(); toggle(); }
      else if (k === "j" || e.key === "ArrowLeft") { e.preventDefault(); seek(now - 5000); }
      else if (k === "l" || e.key === "ArrowRight") { e.preventDefault(); seek(now + 5000); }
      else if (k === "m") setMuted(m => !m);
      else if (k === "s") setSpeed(s => SPEEDS[(SPEEDS.indexOf(s as any) + 1) % SPEEDS.length]);
      else if (k === "f") fullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Hide controls after 2.5 s without pointer movement while playing.
  useEffect(() => {
    if (!playing) { setIdle(false); return; }
    let timer = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => { setIdle(false); clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 2500); };
    const el = wrap.current!; el.addEventListener("pointermove", wake);
    return () => { clearTimeout(timer); el.removeEventListener("pointermove", wake); };
  }, [playing]);

  const onTime = () => {
    const el = v.current!; const ms = el.currentTime * 1000;
    setT(ms);
    // A view counts after 2 s of playback (or the whole video, if shorter).
    const w = watched.current;
    if (!el.paused && !w.sent) {
      const d = ms - w.last; if (d > 0 && d < 1000) w.ms += d;
      if (w.ms >= Math.min(2000, dur - 100)) { w.sent = true; onWatched(); }
    }
    w.last = ms;
  };
  const fullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    const w = wrap.current as HTMLDivElement | null;
    if (w?.requestFullscreen) w.requestFullscreen().catch(() => {});
    else (v.current as any)?.webkitEnterFullscreen?.(); // iPhone: only the video element can go full screen
  };
  const pct = (ms: number) => `${(clamp(ms) / dur) * 100}%`;
  const inside = (ms: number) => ms >= 0 && ms <= dur;
  const ch = chapterAt(video.chapters, t);

  return (
    <div className={`player ${playing ? "playing" : ""} ${idle ? "idle" : ""} ${started ? "" : "fresh"}`} ref={wrap} data-testid="player">
      <video ref={v} src={unsupported ? undefined : `/api/videos/${video.id}/media`} poster={video.hasThumbnail ? `/api/videos/${video.id}/thumbnail` : undefined} preload="metadata" playsInline
        onLoadedMetadata={() => { const p = pendingSeek.current; pendingSeek.current = null; seek(p ?? startAtMs ?? 0); }} onTimeUpdate={onTime} onPlay={() => { setPlaying(true); setEnded(false); watched.current.last = v.current!.currentTime * 1000; }} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setEnded(true); }} onClick={toggle} data-testid="video"
        onError={() => { const c = v.current?.error?.code; if (c === 3 || c === 4) setUnsupported(true); }} />
      {unsupported && (
        <div className="format-notice" role="alert" data-testid="format-notice">
          <strong>This browser can't play this recording</strong>
          <p>It was saved as {video.contentType.includes("webm") ? "WebM" : "MP4"}, which this device doesn't support. {video.allowDownload ? "Download it to watch in another app, or open the link on a computer." : "Open the link on a computer to watch it."}</p>
          {(video.allowDownload || video.isOwner) && <a className="btn btn-primary" href={`/api/videos/${video.id}/media?download`} download><IconDownload size={16} /> Download</a>}
        </div>
      )}
      {!started && !unsupported && (
        <button className="big-play" onClick={play} aria-label="Play, keyboard shortcut K"><IconPlay size={34} /><span className="big-play-meta">{formatTime(dur)}{speed !== 1 ? ` · ${speed}×` : ""}</span></button>
      )}
      {ended && started && <button className="big-play replay" onClick={play} aria-label="Replay"><IconPlay size={30} /><span className="big-play-meta">Replay</span></button>}
      <div className="bursts" aria-hidden="true">{bursts.map(b => <span key={b.id} style={{ left: `${b.x}%` }}>{b.emoji}</span>)}</div>
      <div className="controls" onClick={e => e.stopPropagation()}>
        <div className="seekbar">
          <div className="markers" aria-hidden="true">
            {reactions.filter(r => inside(r.timeMs)).map(r => <span key={r.id} className="m-reaction" style={{ left: pct(r.timeMs) }}>{r.emoji}</span>)}
            {comments.filter(c => c.timeMs !== null && inside(c.timeMs!)).map(c => <span key={c.id} className="m-comment" style={{ left: pct(c.timeMs!) }} title={`${c.authorName}: ${c.body}`} />)}
          </div>
          <div className="track">
            {(video.chapters.length ? video.chapters : [{ timeMs: 0, title: "" }]).map((c: Chapter, i, arr) => {
              const s = clamp(c.timeMs), e = clamp(arr[i + 1]?.timeMs ?? dur);
              if (e <= s) return null;
              const fill = Math.min(1, Math.max(0, (t - s) / (e - s)));
              return <span key={i} className="seg-part" style={{ left: `${(s / dur) * 100}%`, width: `calc(${(e - s) / dur * 100}% - ${video.chapters.length ? 2 : 0}px)` }}><i style={{ width: `${fill * 100}%` }} /></span>;
            })}
          </div>
          <input type="range" aria-label="Seek" min={0} max={dur} step={100} value={Math.round(clamp(t))} aria-valuetext={`${formatTime(t)} of ${formatTime(dur)}`}
            onChange={e => seek(Number(e.target.value))} />
        </div>
        <div className="control-row">
          <button className="ctl" onClick={toggle} aria-label={playing ? "Pause, keyboard shortcut K" : "Play, keyboard shortcut K"}>{playing ? <IconPause size={20} /> : <IconPlay size={20} />}</button>
          <button className="ctl" onClick={() => seek(t - 5000)} aria-label="Back 5 seconds, keyboard shortcut J"><IconBack5 size={20} /></button>
          <button className="ctl" onClick={() => seek(t + 5000)} aria-label="Forward 5 seconds, keyboard shortcut L"><IconFwd5 size={20} /></button>
          <div className="volume">
            <button className="ctl" onClick={() => setMuted(m => !m)} aria-label={muted ? "Unmute, keyboard shortcut M" : "Mute, keyboard shortcut M"}>{muted || volume === 0 ? <IconMute size={20} /> : <IconVolume size={20} />}</button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume" onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }} />
          </div>
          <span className="time" data-testid="time">{formatTime(clamp(t))} / {formatTime(dur)}</span>
          {ch >= 0 && <span className="chapter-now" data-testid="chapter-now">· {video.chapters[ch].title}</span>}
          <span className="grow" />
          <div className="menu-wrap">
            <button className="ctl speed" onClick={() => setSpeedMenu(m => !m)} aria-label="Playback speed, keyboard shortcut S" aria-expanded={speedMenu}>{speed}×</button>
            {speedMenu && (
              <div className="menu speed-menu" role="menu">
                <div className="menu-label">Playback speed</div>
                {SPEEDS.map(s => <button key={s} role="menuitemradio" aria-checked={s === speed} onClick={() => { setSpeed(s); setSpeedMenu(false); }}><span>{s}×</span><span className="muted">{formatTime(atSpeed(dur, s))}</span></button>)}
              </div>
            )}
          </div>
          <button className="ctl" onClick={fullscreen} aria-label="Full screen, keyboard shortcut F"><IconFullscreen size={20} /></button>
        </div>
      </div>
    </div>
  );
});
