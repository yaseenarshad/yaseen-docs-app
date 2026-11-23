-- YAZ-6372: Track single-use friend invite redemption so same-user retries/double-accepts are idempotent.
ALTER TABLE invites ADD COLUMN used_by INTEGER;
ALTER TABLE invites ADD COLUMN used_at TEXT;
