-- Public tables remain the published snapshot. A working copy is initialized
-- from its current post on the first save, within the same transaction.
CREATE TABLE editor_working_copies (
  post_id TEXT PRIMARY KEY NOT NULL,
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
  revision INTEGER NOT NULL CHECK (revision >= 0),
  published_revision INTEGER CHECK (published_revision >= 0 AND published_revision <= revision),
  updated_at TEXT NOT NULL
);
