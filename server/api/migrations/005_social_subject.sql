-- Этап 2 «Решай обществознание»: общий аккаунт, отдельные предметные данные.
--
-- 🔴 ГЛАВНЫЙ ИНВАРИАНТ. Общими с историей остаются РОВНО три таблицы —
-- app_users, user_identities, user_sessions. Всё учебное у обществознания своё:
-- состояние, попытки, классы, ДЗ, квота, рейтинг. Ни одна таблица истории
-- (student_states, student_profiles, classes, assignments, usage_counters) здесь
-- не упоминается и не изменяется. Названия с префиксом social_ выбраны так,
-- чтобы случайный запрос к «не тому предмету» не компилировался, а не молча
-- вернул чужие строки.
--
-- 🔴 ВСЕ ссылки на пользователя — ON DELETE CASCADE. В 001_initial.sql почти
-- везде стоит SET NULL, и удаление аккаунта оставляло бы прогресс «ничейным»:
-- ФИО и вся работа никуда не деваются, просто теряют владельца. Требование
-- плана «удаление аккаунта удаляет и все social_* данные пользователя»
-- выполняется здесь схемой, а не аккуратностью кода в DELETE /api/v1/me.
--
-- День и неделя везде date по Europe/Moscow: считает их сервер (src/moscow-time.js),
-- клиент своё время не присылает — иначе квота добиралась бы переводом часов на
-- телефоне, а неделя рейтинга разъезжалась бы на три часа каждую ночь.

BEGIN;

-- Предметный профиль. Имя и настройки обществознания живут отдельно от истории:
-- один человек может подписываться в двух предметах по-разному.
--
-- role меняет ТОЛЬКО сервер: у ученика нет ни одного маршрута, который пишет это
-- поле (см. ALLOWED_PROFILE_FIELDS в src/subjects/social/schema.js). Учителя
-- назначает внутренний маршрут под INTERNAL_API_TOKEN или админ.
CREATE TABLE IF NOT EXISTS social_profiles (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_profiles_role_idx ON social_profiles(role) WHERE role <> 'student';

-- Снимок прогресса. Ускоряет запуск приложения, но НЕ является источником
-- баллов: баллы считаются по событиям попыток. revision растёт на каждую запись
-- и проверяется оптимистически — два устройства не затирают друг друга молча.
CREATE TABLE IF NOT EXISTS social_states (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- События попыток — единственный доверенный источник баллов ДЗ и рейтинга.
--
-- event_id генерирует клиент (UUID) и он же PRIMARY KEY: повторная доставка из
-- офлайн-очереди не создаёт вторую попытку. Это буквальное требование плана
-- «повтор запроса с тем же eventId не создаёт вторую попытку», и держится оно
-- на ограничении базы, а не на проверке в коде.
CREATE TABLE IF NOT EXISTS social_attempt_events (
  event_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  task_type text NOT NULL DEFAULT '',
  block_ids text[] NOT NULL DEFAULT '{}',
  topic_codes text[] NOT NULL DEFAULT '{}',
  has_images boolean NOT NULL DEFAULT false,
  correct boolean NOT NULL DEFAULT false,
  earned integer NOT NULL DEFAULT 0,
  possible integer NOT NULL DEFAULT 1,
  elapsed_ms integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'practice',
  exam_line integer NOT NULL DEFAULT 0,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  msk_day date NOT NULL,
  week_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Под пересчёт ДЗ: «мои попытки после выдачи задания, по одной на задание».
CREATE INDEX IF NOT EXISTS social_attempt_events_user_time_idx
  ON social_attempt_events(user_id, attempted_at);
CREATE INDEX IF NOT EXISTS social_attempt_events_user_task_idx
  ON social_attempt_events(user_id, task_id);

-- Классы обществознания. Отдельные от классов истории: учитель ведёт разные
-- группы по разным предметам, и код приглашения не должен пересекаться.
CREATE TABLE IF NOT EXISTS social_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  join_code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
-- Код приглашения обязан быть уникальным: по нему ученик попадает в класс, и
-- совпадение означало бы попадание в чужой.
CREATE UNIQUE INDEX IF NOT EXISTS social_classes_join_code_uq ON social_classes(join_code);
CREATE INDEX IF NOT EXISTS social_classes_teacher_idx ON social_classes(teacher_user_id);

CREATE TABLE IF NOT EXISTS social_class_members (
  class_id uuid NOT NULL REFERENCES social_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS social_class_members_user_idx ON social_class_members(user_id);

-- Домашнее задание. Фильтры ровно те, что есть в предмете: типы заданий, блоки
-- КЭС, темы КЭС, цель в вопросах, срок и отдельная настройка №9.
--
-- include_images = false по умолчанию НЕ случайность: 155 заданий с графиками —
-- это формат №9, он выключен в самом приложении и должен включаться в ДЗ только
-- явным решением учителя.
--
-- issued_at — момент выдачи. Выполнение считается по событиям ПОСЛЕ него, иначе
-- ДЗ засчитывалось бы прошлой работой ученика.
CREATE TABLE IF NOT EXISTS social_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES social_classes(id) ON DELETE CASCADE,
  teacher_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  types text[] NOT NULL DEFAULT '{}',
  blocks text[] NOT NULL DEFAULT '{}',
  topics text[] NOT NULL DEFAULT '{}',
  question_goal integer NOT NULL DEFAULT 10 CHECK (question_goal BETWEEN 1 AND 200),
  include_images boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_assignments_class_idx ON social_assignments(class_id, status);

-- Кэш выполнения. Пересчитывается из событий в той же транзакции, что и вставка
-- события: клиентские суммы источником не являются.
CREATE TABLE IF NOT EXISTS social_assignment_progress (
  assignment_id uuid NOT NULL REFERENCES social_assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  earned integer NOT NULL DEFAULT 0,
  possible integer NOT NULL DEFAULT 0,
  questions integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (assignment_id, user_id)
);

-- Дневная квота обществознания. Своя таблица, а не usage_counters истории:
-- предметы не должны съедать лимит друг у друга.
CREATE TABLE IF NOT EXISTS social_usage_counters (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day date NOT NULL,
  kind text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, kind)
);
CREATE INDEX IF NOT EXISTS social_usage_counters_day_idx ON social_usage_counters(day);

-- Недельный рейтинг. week_start — понедельник по Москве; строка недели приходит
-- не от клиента, а из src/moscow-time.js.
CREATE TABLE IF NOT EXISTS social_weekly_scores (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  points integer NOT NULL DEFAULT 0,
  questions integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS social_weekly_scores_board_idx
  ON social_weekly_scores(week_start, points DESC);

COMMIT;
