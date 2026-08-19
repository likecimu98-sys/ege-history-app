-- Вариант учителя: место в бланке и задание из банка ФИПИ.
--
-- Зачем. 007 научил выдавать домашку из собственных заданий учителя — но
-- только из собственных и без номеров. Учителя просят другое: собрать ЦЕЛЫЙ
-- вариант первой части, где все шестнадцать заданий свои, кроме тех, которые
-- своими быть не могут. Прежде всего это №9: там диаграмма, и рисовать её
-- учитель не станет — он хочет кнопку «любое из банка».
--
-- Отсюда два изменения состава.
--
-- 1. exam_line — номер строки бланка (1..16). Он же задаёт вес задания: №3
--    стоит балл, №6 — два, хотя механика у них одна. Без номера вариант
--    оценивался бы «как получится», и сравнить его с реальным экзаменом было
--    бы нельзя. 0 означает «место в бланке не задано» — так выглядят все ранее
--    выданные домашки из своих заданий, и они обязаны продолжать работать.
--
-- 2. bank_task_id — задание ФИПИ вместо своего. Строка состава теперь ссылается
--    ЛИБО на задание учителя, ЛИБО на задание банка; ровно одно из двух
--    гарантирует CHECK. Хранится именно конкретный ID, а не «подставь любое при
--    выдаче»: вариант — это то, что класс решает и разбирает вместе, и у всех
--    учеников №9 обязан быть одним и тем же.
--
-- 🔴 Первичный ключ переезжает с (assignment_id, custom_task_id) на
-- (assignment_id, position). Старый ключ запрещал пустое задание учителя и
-- физически не мог удержать строку из банка. Позиция уникальна и сегодня: она
-- проставляется индексом в присланном списке.
--
-- Миграция идемпотентна: прогоняется при каждом деплое.

BEGIN;

-- 🔴 Порядок здесь не косметический. PostgreSQL отказывается снимать NOT NULL с
-- колонки, входящей в первичный ключ («column is in a primary key»), поэтому
-- ключ снимается ПЕРВЫМ. Обратный порядок роняет всю миграцию, а вместе с ней —
-- и запуск сервера: миграции прогоняются при старте.
ALTER TABLE social_assignment_tasks
  DROP CONSTRAINT IF EXISTS social_assignment_tasks_pkey;

ALTER TABLE social_assignment_tasks
  ALTER COLUMN custom_task_id DROP NOT NULL;

ALTER TABLE social_assignment_tasks
  ADD COLUMN IF NOT EXISTS bank_task_id text NOT NULL DEFAULT '';

ALTER TABLE social_assignment_tasks
  ADD COLUMN IF NOT EXISTS exam_line integer NOT NULL DEFAULT 0;

ALTER TABLE social_assignment_tasks
  ADD CONSTRAINT social_assignment_tasks_pkey PRIMARY KEY (assignment_id, position);

-- Ровно один источник задания на строку. Строка без источника — это вопрос,
-- который ученику нечем показать; строка с двумя — вопрос, который непонятно
-- как считать.
ALTER TABLE social_assignment_tasks
  DROP CONSTRAINT IF EXISTS social_assignment_tasks_one_source;
ALTER TABLE social_assignment_tasks
  ADD CONSTRAINT social_assignment_tasks_one_source
  CHECK ((custom_task_id IS NOT NULL) <> (bank_task_id <> ''));

ALTER TABLE social_assignment_tasks
  DROP CONSTRAINT IF EXISTS social_assignment_tasks_exam_line;
ALTER TABLE social_assignment_tasks
  ADD CONSTRAINT social_assignment_tasks_exam_line
  CHECK (exam_line BETWEEN 0 AND 16);

COMMIT;
