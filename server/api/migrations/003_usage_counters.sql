-- Дневные счётчики расхода. До этой миграции дневной лимит строк считался
-- ИСКЛЮЧИТЕЛЬНО на клиенте (state.js, canSolveMore) по localStorage, то есть
-- снимался из DevTools за десять секунд. Платный контур обходился тривиально.
--
-- День хранится как date по Europe/Moscow: у приложения российская аудитория и
-- экзамен по московскому времени, а device-local дата у клиента позволяла бы
-- добирать строки простым переводом часов на телефоне.
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day date NOT NULL,
  kind text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, kind)
);

-- Для регулярной уборки старых дней (счётчики нужны только за сегодня).
CREATE INDEX IF NOT EXISTS usage_counters_day_idx ON usage_counters(day);
