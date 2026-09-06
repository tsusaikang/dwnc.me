PRAGMA foreign_keys = ON;

CREATE TABLE legacy_posts (
  id TEXT PRIMARY KEY NOT NULL,
  global_sequence INTEGER NOT NULL UNIQUE CHECK (global_sequence BETWEEN 1 AND 596),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status = 'published'),
  source TEXT NOT NULL CHECK (source IN ('tistory', 'naver')),
  source_id TEXT NOT NULL,
  source_url TEXT,
  legacy_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  category_label TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  legacy_categories_json TEXT NOT NULL,
  cover_path TEXT,
  cover_alt TEXT NOT NULL,
  cover_media_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source_updated_at TEXT,
  UNIQUE (source, source_id)
);

CREATE TABLE legacy_media (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES legacy_posts(id),
  public_path TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL,
  alt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX legacy_posts_updated
  ON legacy_posts (updated_at DESC, id ASC);
CREATE INDEX legacy_posts_public_sequence
  ON legacy_posts (global_sequence DESC);
CREATE INDEX legacy_media_post
  ON legacy_media (post_id, created_at);
