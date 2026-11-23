-- Atomic idempotency log so each notification event (per recipient + dedupe key)
-- fires at most once, even under concurrent PUT /api/friends/stats or cron retries.
CREATE TABLE IF NOT EXISTS push_deliveries (
  user_id INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_created ON push_deliveries(created_at);
