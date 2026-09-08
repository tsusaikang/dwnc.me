-- Start every existing post at zero without updating or backfilling post rows.
-- Only anonymous daily totals are stored, never request/visitor identifiers.
CREATE TABLE post_view_daily (
  post_id TEXT NOT NULL,
  day TEXT NOT NULL CHECK (length(day) = 10),
  views INTEGER NOT NULL CHECK (views >= 0),
  PRIMARY KEY (post_id, day)
);
CREATE INDEX post_view_daily_day ON post_view_daily(day);
