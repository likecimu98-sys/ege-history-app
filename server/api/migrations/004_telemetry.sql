-- Наблюдаемость: свой сбор ошибок и продуктовых событий.
--
-- Почему СВОЯ таблица, а не Sentry/GlitchTip. Данные касаются несовершеннолетних:
-- отправлять их стек-трейсы и поведение стороннему сервису — это новый оператор
-- персональных данных, новое основание обработки и новая строка в политике.
-- Своя таблица на том же сервере не добавляет ни одного юридического вопроса,
-- а объёмы у проекта такие, что внешний агрегатор не нужен.
-- Оба потока пишутся ОБЕЗЛИЧЕННО (см. server.js, /api/v1/telemetry).

CREATE TABLE IF NOT EXISTS client_errors (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Отпечаток ошибки: sha256(сообщение + место). По нему одинаковые ошибки
  -- схлопываются в одну строку счётчиком, иначе один сломанный экран у тысячи
  -- человек — это тысяча строк за минуту.
  fingerprint text NOT NULL,
  message text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  release text NOT NULL DEFAULT '',
  -- Платформа, а не user-agent целиком: 'ios'/'android'/'desktop'/'tg'.
  platform text NOT NULL DEFAULT '',
  count integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fingerprint)
);
CREATE INDEX IF NOT EXISTS client_errors_last_seen_idx ON client_errors(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS product_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- ⚠️ user_id нужен, чтобы считать DAU и возврат D1/D7. Это внутренний uuid,
  -- не Telegram ID и не имя. При удалении аккаунта строки уходят каскадом.
  user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Только числа и короткие метки. Ничего, что вводит человек.
  props jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS product_events_name_time_idx ON product_events(name, created_at DESC);
CREATE INDEX IF NOT EXISTS product_events_user_time_idx ON product_events(user_id, created_at DESC);
