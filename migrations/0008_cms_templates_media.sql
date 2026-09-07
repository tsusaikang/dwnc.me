-- Independent reusable formats and site-owned icons. No post rows are changed.
CREATE TABLE cms_templates (
  key TEXT PRIMARY KEY CHECK (key = 'templates'),
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);
CREATE TABLE cms_media (
  id TEXT PRIMARY KEY,
  public_path TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
