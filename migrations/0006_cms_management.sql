-- Management metadata only. Existing post content is not rewritten.
CREATE TABLE cms_configuration (
  key TEXT PRIMARY KEY CHECK (key IN ('categories', 'settings')),
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);
ALTER TABLE native_posts ADD COLUMN cover_path TEXT;
ALTER TABLE native_posts ADD COLUMN cover_alt TEXT NOT NULL DEFAULT '';
ALTER TABLE editor_working_copies ADD COLUMN cover_path TEXT;
ALTER TABLE editor_working_copies ADD COLUMN cover_alt TEXT;
-- NULL means an older working copy inherits its parent's cover selection.
ALTER TABLE editor_working_copies ADD COLUMN cover_selection_set INTEGER;
