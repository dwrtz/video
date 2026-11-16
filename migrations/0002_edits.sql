-- 0.1.1: a removed middle section and a "muted for viewers" flag. Existing videos keep NULL/0, so nothing about them changes.
ALTER TABLE videos ADD COLUMN cut_start_ms INTEGER;
ALTER TABLE videos ADD COLUMN cut_end_ms INTEGER;
ALTER TABLE videos ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
