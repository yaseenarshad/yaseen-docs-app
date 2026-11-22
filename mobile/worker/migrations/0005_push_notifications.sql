-- Web Push subscriptions & per-user notification preferences
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY,
  daily_reminder INTEGER NOT NULL DEFAULT 1,
  reminder_hour INTEGER NOT NULL DEFAULT 20,
  friend_finished_mode TEXT NOT NULL DEFAULT 'all',
  friend_finished_ids_json TEXT NOT NULL DEFAULT '[]',
  buddy_streak INTEGER NOT NULL DEFAULT 1,
  shared_cards INTEGER NOT NULL DEFAULT 1,
  last_reminder_day TEXT,
  updated_at TEXT NOT NULL
);
