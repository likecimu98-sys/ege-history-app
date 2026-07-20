BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_doc_id text,
  display_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_canonical_doc_id_uq
  ON app_users (canonical_doc_id) WHERE canonical_doc_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_identities (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('telegram', 'google', 'guest', 'legacy')),
  subject text NOT NULL,
  email text NOT NULL DEFAULT '',
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities(user_id);

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  ip_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS user_sessions_active_idx
  ON user_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  verifier text NOT NULL,
  return_to text NOT NULL DEFAULT '/',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Each compatibility collection has its own table. JSONB preserves the current
-- document shape while auth/session data is normalized above.
CREATE TABLE IF NOT EXISTS student_profiles (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_profiles_user_idx ON student_profiles(user_id);
CREATE INDEX IF NOT EXISTS student_profiles_class_idx ON student_profiles((data->>'classCode'));
CREATE INDEX IF NOT EXISTS student_profiles_total_idx ON student_profiles(((data->>'totalSolved')::numeric))
  WHERE (data->>'totalSolved') ~ '^-?[0-9]+([.][0-9]+)?$';

CREATE TABLE IF NOT EXISTS student_states (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_states_user_idx ON student_states(user_id);

CREATE TABLE IF NOT EXISTS teacher_profiles (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS duel_matches (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS duel_matches_status_idx ON duel_matches((data->>'status'));

CREATE TABLE IF NOT EXISTS login_tokens (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_sessions (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_jobs_pending_idx
  ON notification_jobs(status, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS app_config (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leaderboards (
  doc_id text PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Normalized assignment tables are populated by the importer and future API
-- writes. The JSON state remains authoritative during the compatibility phase.
CREATE TABLE IF NOT EXISTS assignments (
  id text PRIMARY KEY,
  class_code text,
  teacher_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_assignments (
  assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_user_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
