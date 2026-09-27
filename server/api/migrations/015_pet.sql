-- «Летописчик»: питомец ученика, кошелёк монет, итоги недели.
--
-- Почему своя таблица, а не поле в прогрессе ученика. Блоб прогресса пишет сам
-- клиент, и при слиянии двух устройств баланс в нём либо удвоился бы, либо
-- пропал: merge не умеет «списать 150 монет ровно один раз». Здесь каждое
-- движение монет — строка журнала, а баланс меняется только внутри транзакции
-- под блокировкой строки кошелька.

CREATE TABLE IF NOT EXISTS pet_wallets (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  earned_total bigint NOT NULL DEFAULT 0,
  spent_total bigint NOT NULL DEFAULT 0,
  -- Отметки счётчиков профиля, до которых монеты уже начислены:
  -- {solved, ege, duelWins}. Пусто — питомец ещё не вылупился, начислять не с чего.
  marks jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Московский день и сколько монет за решение в нём уже начислено (потолок дня),
  -- плюс серия дней подряд: {day, earned, streak, lastDay}.
  daily jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Сам питомец: {species, name, sat, mood, health, sick, starvingH, at, hatchedAt, toys:{id:ts}}.
  pet jsonb,
  -- Надетое: {slot: itemId}.
  equipped jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Цвет ника: {color, until, crown, source}.
  name_style jsonb,
  -- Счётчики гаранта коробок: {box_chest: N, box_tsar: N} — сколько открыто с последней «удачи».
  pity jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Награды топа недели: {top1, top3, top10, top50, lastWeek}.
  awards jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Разные счётчики для ачивок питомца: {boxes, fedDays, lastFedDay, fedStreak}.
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pet_inventory (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  qty integer NOT NULL DEFAULT 1 CHECK (qty >= 0),
  source text NOT NULL DEFAULT '',
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
-- «Есть у 3 человек» для мифических вещей.
CREATE INDEX IF NOT EXISTS pet_inventory_item_idx ON pet_inventory(item_id) WHERE qty > 0;

CREATE TABLE IF NOT EXISTS pet_ledger (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  delta bigint NOT NULL,
  reason text NOT NULL,
  ref text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_ledger_user_idx ON pet_ledger(user_id, created_at DESC);
-- Разовые начисления (ачивка, итоги недели) оплачиваются ровно один раз —
-- держит база, а не проверка в коде перед вставкой.
CREATE UNIQUE INDEX IF NOT EXISTS pet_ledger_once_uq
  ON pet_ledger(user_id, reason, ref) WHERE reason IN ('achievement', 'weekly');

-- Недельный топ живёт в профиле ученика и переписывается новой неделей при
-- первом же входе в понедельник. Поэтому итоги недели подводятся по снимкам,
-- которые сервер делает сам каждые 15 минут, а не по профилям после факта.
CREATE TABLE IF NOT EXISTS weekly_top_snapshots (
  week text NOT NULL,
  doc_id text NOT NULL,
  user_id uuid,
  score integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week, doc_id)
);
CREATE INDEX IF NOT EXISTS weekly_top_snapshots_rank_idx ON weekly_top_snapshots(week, score DESC);

-- Одна строка на подведённую неделю: первичный ключ и не даёт выдать награды дважды.
CREATE TABLE IF NOT EXISTS weekly_awards (
  week text PRIMARY KEY,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  awarded_at timestamptz NOT NULL DEFAULT now()
);
