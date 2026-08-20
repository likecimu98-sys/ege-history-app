-- Чья это работа: к какой домашке относится ответ.
--
-- Зачем. Ответ засчитывался КАЖДОЙ активной домашке, чьим фильтрам он подходил.
-- 20.08.2026 у ученицы домашка с целью 20 вопросов показывала «36 отвечено»:
-- 25 заданий она решила в окне первой домашки, 17 — в окне второй, шесть
-- совпали, и всё это целиком записалось обеим. Закрытая домашка продолжала
-- набирать ответы неделю спустя, а два задания двигались одним и тем же
-- действием. Учителю такие числа не объяснить.
--
-- Теперь ответ, данный ВНУТРИ домашки, принадлежит ей одной. Свободная
-- тренировка (assignment_id IS NULL) по-прежнему засчитывается всякой
-- подходящей домашке — иначе ученик решал бы по теме и не понимал, почему
-- счётчик стоит.
--
-- 🔴 Колонка nullable, и это не небрежность. У всех событий, записанных до этой
-- миграции, принадлежности нет и взяться ей неоткуда: клиент её не присылал.
-- NOT NULL со значением по умолчанию приписал бы всю прошлую работу одной
-- домашке. NULL честно означает «неизвестно» и разбирается старым правилом.
--
-- ON DELETE SET NULL: удалённая домашка не должна уносить историю попыток —
-- баллы ученика и рейтинг считаются по тем же событиям.

BEGIN;

ALTER TABLE social_attempt_events
  ADD COLUMN IF NOT EXISTS assignment_id uuid;

ALTER TABLE social_attempt_events
  DROP CONSTRAINT IF EXISTS social_attempt_events_assignment_fk;
ALTER TABLE social_attempt_events
  ADD CONSTRAINT social_attempt_events_assignment_fk
  FOREIGN KEY (assignment_id) REFERENCES social_assignments(id) ON DELETE SET NULL;

-- Пересчёт домашки ходит по (user_id, attempted_at) и отбирает по принадлежности.
CREATE INDEX IF NOT EXISTS social_attempt_events_assignment_idx
  ON social_attempt_events(assignment_id) WHERE assignment_id IS NOT NULL;

COMMIT;
