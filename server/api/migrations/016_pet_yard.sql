-- «Летописчик» v3: хвастаться питомцем без общей ленты (решение владельца 27.09.2026).
--
-- Наружу питомца показываем по публичному id: ни doc_id, ни Telegram ID, ни
-- внутренний uuid в ответах не бывают. Свободного текста нигде нет — ученики
-- несовершеннолетние, модерировать нечего: реакции из четырёх эмодзи, голос в
-- баттле, новости из готовых шаблонов.

ALTER TABLE pet_wallets ADD COLUMN IF NOT EXISTS public_id text;
UPDATE pet_wallets SET public_id = substr(md5(random()::text || user_id::text || clock_timestamp()::text), 1, 12)
  WHERE public_id IS NULL;
ALTER TABLE pet_wallets ALTER COLUMN public_id SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12);
CREATE UNIQUE INDEX IF NOT EXISTS pet_wallets_public_uq ON pet_wallets(public_id);

-- Реакция на чужого питомца: одна от человека к человеку в московские сутки.
CREATE TABLE IF NOT EXISTS pet_reactions (
  from_user uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day text NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_user, to_user, day)
);
CREATE INDEX IF NOT EXISTS pet_reactions_to_idx ON pet_reactions(to_user);

-- «Кто круче?»: голос за одного из двух случайных питомцев. Неделя — для топа стиля.
CREATE TABLE IF NOT EXISTS pet_votes (
  id bigserial PRIMARY KEY,
  voter uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day text NOT NULL,
  week text NOT NULL,
  winner uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  loser uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_votes_voter_day_idx ON pet_votes(voter, day);
CREATE INDEX IF NOT EXISTS pet_votes_week_idx ON pet_votes(week, winner);

-- «Новости двора»: только крупное (Мудрец, редкий вид, мифическая вещь, икона
-- стиля). Параметры — готовые поля шаблона, текст собирает клиент.
CREATE TABLE IF NOT EXISTS pet_news (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_news_created_idx ON pet_news(created_at DESC);

-- Приглашения: кто кого привёл. Приглашённый — один раз на всю жизнь.
CREATE TABLE IF NOT EXISTS pet_referrals (
  invitee uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  inviter uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_referrals_inviter_idx ON pet_referrals(inviter);
