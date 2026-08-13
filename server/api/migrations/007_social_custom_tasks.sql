-- Свои задания учителя и домашка-«вариант» из них.
--
-- Зачем. До этого ДЗ можно было собрать только фильтром по банку ФИПИ: типы,
-- блоки, темы. Учителю этого мало — он хочет дать СВОЙ вариант: свои
-- формулировки, свои варианты ответа, свой порядок. Раньше единственным
-- способом было продиктовать задания вслух, а в приложении отметить «решай что
-- угодно».
--
-- 🔴 Задания принадлежат УЧИТЕЛЮ, а не классу. Один и тот же вариант выдают
-- нескольким классам и в следующем году — привязка к классу означала бы копию
-- на каждую выдачу и расхождение правок.
--
-- 🔴 Ссылка на app_users — ON DELETE CASCADE, как и во всей 005: удаление
-- аккаунта обязано уносить и созданные задания, иначе после удаления учителя
-- его тексты остались бы жить в чужих ДЗ без владельца.
--
-- ALTER здесь появляется впервые (в 005 его нет намеренно). Он добавляет
-- колонку в СВОЮ таблицу предмета и написан идемпотентно: миграции
-- прогоняются повторно при каждом деплое.

BEGIN;

-- Банк заданий учителя. Формат ровно тот же, что у банка ФИПИ, — иначе
-- приложению пришлось бы уметь рисовать и проверять второй вид задания:
--   options — варианты/колонки: [{ "n": 1, "text": "…" }]
--   targets — строки соответствия: [{ "label": "А", "text": "…" }] (пусто у прочих типов)
--   answer  — строка цифр: для выбора «13», для соответствия по цифре на строку «12212»
CREATE TABLE IF NOT EXISTS social_custom_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('task1', 'task12', 'task13', 'matching', 'choice')),
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer text NOT NULL DEFAULT '',
  blocks text[] NOT NULL DEFAULT '{}',
  topics text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_custom_tasks_teacher_idx
  ON social_custom_tasks(teacher_user_id, status, created_at DESC);

-- Откуда собрана домашка. 'bank' — фильтр по банку ФИПИ (всё, что было раньше),
-- 'custom' — явный список заданий учителя.
--
-- Значение по умолчанию 'bank' обязательно: у всех уже выданных ДЗ источник
-- именно такой, и без DEFAULT они стали бы «вариантом без заданий», то есть
-- невыполнимыми.
-- CHECK объявлен прямо в ADD COLUMN, а не отдельным ALTER ... ADD CONSTRAINT:
-- при повторном прогоне IF NOT EXISTS пропускает всю команду целиком вместе с
-- ограничением, и миграция остаётся идемпотентной без обращения к системным
-- каталогам.
ALTER TABLE social_assignments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bank'
  CHECK (source IN ('bank', 'custom'));

-- Состав варианта. position — порядок, в котором учитель выстроил задания:
-- вариант это не мешок, а последовательность.
--
-- ON DELETE CASCADE у задания означает, что удалённое задание исчезает и из
-- выданного ДЗ. Поэтому кабинет задания не удаляет, а архивирует: у архивного
-- статус меняется, строки состава остаются, уже выданный вариант не рассыпается.
CREATE TABLE IF NOT EXISTS social_assignment_tasks (
  assignment_id uuid NOT NULL REFERENCES social_assignments(id) ON DELETE CASCADE,
  custom_task_id uuid NOT NULL REFERENCES social_custom_tasks(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (assignment_id, custom_task_id)
);
CREATE INDEX IF NOT EXISTS social_assignment_tasks_assignment_idx
  ON social_assignment_tasks(assignment_id, position);

COMMIT;
