-- YAZ-6298: Custom user profile avatar storage in D1 (<= 50 KB compressed webp/jpeg/png).

CREATE TABLE IF NOT EXISTS user_avatars (
  github_id INTEGER PRIMARY KEY,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
