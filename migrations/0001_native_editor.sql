PRAGMA foreign_keys = ON;

CREATE TABLE native_posts (
  id TEXT PRIMARY KEY NOT NULL,
  global_sequence INTEGER UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'tombstone')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  category_label TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  cover_media_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  CHECK ((status = 'draft' AND global_sequence IS NULL AND published_at IS NULL)
    OR (status IN ('published', 'tombstone') AND global_sequence >= 597 AND published_at IS NOT NULL))
);

CREATE TABLE native_sequence_claims (
  global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL
);

-- The imported/private bootstrap ledger already owns 1 through 596.
INSERT INTO native_sequence_claims (global_sequence, post_id, claimed_at)
VALUES (596, '__bootstrap_through_596__', '2026-09-06T00:00:00.000Z');

CREATE TABLE native_media (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES native_posts(id),
  public_path TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL,
  alt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX native_posts_public_sequence
  ON native_posts (status, global_sequence DESC);
CREATE INDEX native_posts_category
  ON native_posts (status, category_slug, global_sequence DESC);
CREATE INDEX native_media_post
  ON native_media (post_id, created_at);
