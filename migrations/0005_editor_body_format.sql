-- Existing native Markdown and legacy HTML remain unchanged. A nullable working
-- format inherits its parent until that working copy is next explicitly saved.
ALTER TABLE native_posts ADD COLUMN body_format TEXT NOT NULL DEFAULT 'markdown'
  CHECK (body_format IN ('markdown', 'html'));
ALTER TABLE editor_working_copies ADD COLUMN body_format TEXT
  CHECK (body_format IN ('markdown', 'html'));
