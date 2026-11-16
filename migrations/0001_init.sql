-- Accounts own videos; anyone with a video's link can watch, comment and react.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'ready')),
  mode TEXT NOT NULL CHECK (mode IN ('screen_camera', 'screen', 'camera')),
  content_type TEXT NOT NULL,
  upload_id TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  trim_start_ms INTEGER NOT NULL DEFAULT 0,
  trim_end_ms INTEGER,
  chapters TEXT NOT NULL DEFAULT '[]',
  allow_comments INTEGER NOT NULL DEFAULT 1,
  allow_download INTEGER NOT NULL DEFAULT 1,
  has_thumbnail INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX videos_owner ON videos(owner_id, created_at DESC);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_user_id TEXT,
  viewer_id TEXT NOT NULL,
  body TEXT NOT NULL,
  time_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_video ON comments(video_id, created_at);
CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  time_ms INTEGER NOT NULL,
  viewer_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX reactions_video ON reactions(video_id, time_ms);
CREATE TABLE views (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (video_id, viewer_id)
);
