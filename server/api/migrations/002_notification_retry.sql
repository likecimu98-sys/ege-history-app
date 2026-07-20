ALTER TABLE notification_jobs
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS notification_jobs_ready_idx
  ON notification_jobs(next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');
