-- Очередь уведомлений предмета «обществознание».
--
-- 🔴 ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ ОБЩАЯ notification_jobs. Общую очередь
-- разбирает бот истории: он забирает пачку заданий своим токеном и рассылает
-- их. Положи туда социальные — и он попытается отправить их от имени другого
-- бота, то есть уведомление о домашке по обществознанию либо уйдёт не из того
-- чата, либо не уйдёт вовсе, и виноватым окажется «почему-то не работает».
-- Разделение очередей делает эту ошибку невозможной, а не маловероятной.
--
-- 🔴 ОДНА СТРОКА НА ПОЛУЧАТЕЛЯ, и создаются они ОДНИМ оператором
-- INSERT ... SELECT (см. enqueueAssignmentNotifications). Цикл по ученикам с
-- отдельной вставкой на каждого обрывается на первом же сбое, и половина класса
-- молча остаётся без домашки — это ровно тот случай, который уже случался в
-- истории. Отдельная строка на человека даёт ещё и честный повтор: не дошло
-- одному — повторяем одному, а не всем.

BEGIN;

CREATE TABLE IF NOT EXISTS social_notification_jobs (
  id bigserial PRIMARY KEY,
  assignment_id uuid REFERENCES social_assignments(id) ON DELETE CASCADE,
  user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  -- Telegram ID получателя. Хранится строкой: id у Telegram больше 32 бит и в
  -- JSON приходит числом, которое легко потерять в точности.
  telegram_id text NOT NULL,
  kind text NOT NULL DEFAULT 'assignment',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Повторное сохранение того же ДЗ не должно слать второе сообщение тому же
-- ученику. Ограничение частичное: у уведомлений без задания (будущие типы)
-- assignment_id пуст, и они под это правило не попадают.
CREATE UNIQUE INDEX IF NOT EXISTS social_notification_jobs_assignment_uq
  ON social_notification_jobs(assignment_id, telegram_id)
  WHERE assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_notification_jobs_pending_idx
  ON social_notification_jobs(next_attempt_at)
  WHERE status IN ('pending', 'processing');

COMMIT;
