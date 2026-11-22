-- YAZ-6284: Shared deck browsing permissions & vault installation mappings.
-- Privacy rule: defaults to 'none'; no friend can browse any vault unless explicitly enabled.

ALTER TABLE users ADD COLUMN deck_share_mode TEXT NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS deck_permissions (
  owner_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_deck_permissions_friend ON deck_permissions (friend_id);

CREATE TABLE IF NOT EXISTS deck_vaults (
  owner_id INTEGER NOT NULL,
  repo_slug TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, repo_slug)
);
