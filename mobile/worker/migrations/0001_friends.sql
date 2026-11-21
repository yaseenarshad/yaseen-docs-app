-- YAZ-6200: Cloudflare D1 schema for Cards Friends Feature (stats, invites, marks, groups, shared cards & folders).
-- Privacy rule: stores only FriendStats daily counts JSON and explicitly shared cards/folders. Never private vault content.

CREATE TABLE IF NOT EXISTS users (
  github_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  nickname TEXT,
  zone TEXT,
  vaults_json TEXT NOT NULL DEFAULT '[]',
  stats_json TEXT,
  stats_at TEXT,
  streak_current INTEGER NOT NULL DEFAULT 0,
  streak_best INTEGER NOT NULL DEFAULT 0,
  last_done_day TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
  user_a INTEGER NOT NULL,
  user_b INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships (user_b);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL, -- 'friend' | 'group'
  creator_id INTEGER NOT NULL,
  group_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_creator ON invites (creator_id);

CREATE TABLE IF NOT EXISTS marks (
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  kind TEXT NOT NULL, -- 'cheer' | 'nudge'
  message TEXT,
  at TEXT NOT NULL,
  seen_at TEXT,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_marks_to ON marks (to_id);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  admin_id INTEGER NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'active'
  since TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS shared_folders (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  to_user_id INTEGER,
  sender_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shared_folders_group ON shared_folders (group_id);
CREATE INDEX IF NOT EXISTS idx_shared_folders_to ON shared_folders (to_user_id);

CREATE TABLE IF NOT EXISTS shared_cards (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  to_user_id INTEGER,
  folder_id TEXT,
  sender_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  note TEXT,
  attachments_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shared_cards_group ON shared_cards (group_id);
CREATE INDEX IF NOT EXISTS idx_shared_cards_to ON shared_cards (to_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_cards_folder ON shared_cards (folder_id);

CREATE TABLE IF NOT EXISTS shared_card_states (
  user_id INTEGER NOT NULL,
  shared_card_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'accepted' | 'dismissed' (absent row = 'pending')
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, shared_card_id)
);

CREATE TABLE IF NOT EXISTS rate_events (
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'mark' | 'invite' | 'share'
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_events_lookup ON rate_events (user_id, action, at);

CREATE TABLE IF NOT EXISTS daily_activity (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  cards INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_activity_day ON daily_activity (day);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  group_id TEXT,
  kind TEXT NOT NULL, -- 'streak_milestone' | 'group_all_done' | 'card_shared' | 'cheer' | 'nudge'
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_events_user ON activity_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_events_group ON activity_events (group_id, created_at);
