-- 0.1.2: cuts are made in the browser before upload, so the file is what viewers see.
-- media_key points at the current file (NULL = videos/{id}/video); pending_* track a cut copy being uploaded.
ALTER TABLE videos ADD COLUMN media_key TEXT;
ALTER TABLE videos ADD COLUMN pending_key TEXT;
ALTER TABLE videos ADD COLUMN pending_upload_id TEXT;
ALTER TABLE videos ADD COLUMN pending_meta TEXT;
-- Player-side trim, removed section and mute (0.1.0/0.1.1) are gone. Videos that used them play in full after
-- this migration; cut them again in Edit video.
ALTER TABLE videos DROP COLUMN trim_start_ms;
ALTER TABLE videos DROP COLUMN trim_end_ms;
ALTER TABLE videos DROP COLUMN cut_start_ms;
ALTER TABLE videos DROP COLUMN cut_end_ms;
ALTER TABLE videos DROP COLUMN muted;
