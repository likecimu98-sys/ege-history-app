-- Сохранённый вариант учителя.
--
-- Зачем. 009 научил собирать вариант первой части и выдавать его классу. Но
-- жил он ровно до нажатия «выдать»: чтобы дать тот же вариант второму классу,
-- его приходилось собирать заново с нуля. «Выдать ещё раз» вытаскивало состав
-- из уже выданной домашки — то есть вариант существовал только как чей-то
-- прошлый долг, а не как вещь, которую учитель составил и хранит.
--
-- Теперь вариант — самостоятельная сущность с именем. Составил один раз,
-- выдаёшь сколько угодно раз и скольким угодно классам.
--
-- 🔴 Состав лежит в jsonb, а не отдельной таблицей со ссылками на задания.
-- Причина не в лени: ссылка с ON DELETE CASCADE означала бы, что удаление
-- аккаунта или задания молча выпиливает строку из СОХРАНЁННОГО варианта, и
-- учитель узнал бы об этом, выдав классу пятнадцать заданий вместо шестнадцати.
-- Здесь же пропавшее задание остаётся видимой дырой: кабинет показывает
-- «задание недоступно», и вариант чинится осознанно. Формат строки тот же, что
-- принимает выдача: { "line": 1..16, "customTaskId": uuid|"", "bankTaskId": "" }.
--
-- Ссылка на app_users — ON DELETE CASCADE, как во всей 005: удаление аккаунта
-- обязано уносить и составленные варианты.

BEGIN;

CREATE TABLE IF NOT EXISTS social_variant_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_variant_templates_teacher_idx
  ON social_variant_templates(teacher_user_id, updated_at DESC);

COMMIT;
