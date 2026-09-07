-- Publication policy is separate from the preserved public/working snapshots.
CREATE TABLE content_operations (
 post_id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL DEFAULT 'post' CHECK(kind IN ('post','page','notice')),
 visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private','scheduled','protected')),
 scheduled_at TEXT,
 password_salt TEXT,
 password_digest TEXT
);
CREATE TABLE protected_sessions (
 token_digest TEXT PRIMARY KEY NOT NULL,
 post_id TEXT NOT NULL REFERENCES content_operations(post_id),
 expires_at TEXT NOT NULL
);
CREATE INDEX protected_sessions_post ON protected_sessions(post_id);
CREATE TABLE protected_attempts (
 attempt_key TEXT PRIMARY KEY NOT NULL,
 window_start INTEGER NOT NULL,
 count INTEGER NOT NULL
);
