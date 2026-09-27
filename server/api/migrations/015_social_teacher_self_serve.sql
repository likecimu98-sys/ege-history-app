-- 015: роль учителя выдаётся сама, и мы наконец знаем, откуда учителя приходят.
--
-- До этой миграции роль выдавал человек кнопкой в боте. Из 99 учителей класс
-- создали 59, а домашку выдали 38: воронка теряла две трети ещё до того, как
-- учитель успевал что-то сделать, и первым же её шагом было «подождите».
--
-- Только ADD COLUMN: существующие строки не трогаются, у старых учителей
-- role_source останется NULL — это честно, мы про них и правда не знаем.
BEGIN;

ALTER TABLE social_profiles
  ADD COLUMN IF NOT EXISTS invite_code text,
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role_source text,
  ADD COLUMN IF NOT EXISTS role_granted_at timestamptz;

-- Код приглашения коллеги. Частичный уникальный индекс, а не UNIQUE-колонка:
-- NULL у всех учеников, и уникальность нужна только среди выданных кодов.
CREATE UNIQUE INDEX IF NOT EXISTS social_profiles_invite_code_uq
  ON social_profiles(invite_code) WHERE invite_code IS NOT NULL;

-- Ответ на вопрос «откуда пришёл этот учитель» должен быть быстрым: по нему
-- строится вся отчётность о каналах.
CREATE INDEX IF NOT EXISTS social_profiles_invited_by_idx
  ON social_profiles(invited_by_user_id) WHERE invited_by_user_id IS NOT NULL;

-- 🔴 Ограничение добавляем идемпотентно. Повторный ADD CONSTRAINT падает с
-- 42710, а упавшая миграция не даёт API подняться ВООБЩЕ — один повторный
-- запуск положил бы оба предмета, а не только этот.
DO $$
BEGIN
  ALTER TABLE social_profiles
    ADD CONSTRAINT social_profiles_role_source_check
    CHECK (role_source IS NULL OR role_source IN ('manual', 'self', 'invite'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
