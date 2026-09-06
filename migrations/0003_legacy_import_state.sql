ALTER TABLE legacy_posts
  ADD COLUMN import_complete INTEGER NOT NULL DEFAULT 0 CHECK (import_complete IN (0, 1));
