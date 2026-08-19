'use strict';

// Данные обществознания. Единственное место, где для этого предмета пишется SQL.
//
// 🔴 Здесь не должно появиться ни одного имени таблицы истории. Это не пожелание
// к аккуратности: тест social-isolation.test.js читает исходник этого файла и
// падает, если в нём встретится student_states, student_profiles, classes,
// assignments или usage_counters. Общими остаются только app_users,
// user_identities и user_sessions — и трогаем мы их лишь по внешнему ключу.
//
// Все функции принимают db (по умолчанию общий pool), чтобы тесты гонялись на
// подставном соединении: поднимать PostgreSQL ради проверки того, ЧТО именно
// сервер считает источником баллов, не нужно.

const crypto = require('crypto');
const { pool, tx } = require('../../db');
const { mondayStr, moscowDayStr } = require('../../moscow-time');
const { leaderboardName } = require('../../display-name');
const { JOIN_CODE_ALPHABET, fail } = require('./schema');

const MOSCOW_TODAY = "(now() AT TIME ZONE 'Europe/Moscow')::date";

function numeric(value) {
  return Math.max(0, Number(value) || 0);
}

// ---------------------------------------------------------------------------
// Профиль и роль
// ---------------------------------------------------------------------------

// Профиль создаётся при первом обращении. Роль в ON CONFLICT НЕ трогается:
// иначе повторный вход учителя сбрасывал бы его роль обратно в student.
async function ensureProfile(userId, { displayName = '' } = {}, { db = pool } = {}) {
  const result = await db.query(
    `INSERT INTO social_profiles(user_id, display_name)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = CASE WHEN social_profiles.display_name = '' THEN EXCLUDED.display_name ELSE social_profiles.display_name END,
       updated_at = now()
     RETURNING user_id, display_name, role, settings, created_at, updated_at`,
    [userId, String(displayName || '').slice(0, 80)]);
  return result.rows[0];
}

async function patchProfile(userId, patch, { db = pool } = {}) {
  const current = await ensureProfile(userId, {}, { db });
  const displayName = patch.displayName === null ? current.display_name : patch.displayName;
  const settings = patch.settings === null ? current.settings : { ...(current.settings || {}), ...patch.settings };
  const result = await db.query(
    `UPDATE social_profiles SET display_name=$2, settings=$3, updated_at=now()
     WHERE user_id=$1
     RETURNING user_id, display_name, role, settings, created_at, updated_at`,
    [userId, String(displayName || '').slice(0, 80), JSON.stringify(settings || {})]);
  return result.rows[0];
}

// 🔴 Роль читается ТОЛЬКО отсюда и меняется только setRole, у которого нет
// пользовательского маршрута. Ученик, приславший {"role":"teacher"}, получает
// 400 ещё в schema.js: в белом перечне полей профиля роли нет.
async function roleOf(userId, { db = pool } = {}) {
  const result = await db.query('SELECT role FROM social_profiles WHERE user_id=$1', [userId]);
  return result.rowCount ? String(result.rows[0].role || 'student') : 'student';
}

async function setRole(userId, role, { db = pool } = {}) {
  if (!['student', 'teacher', 'admin'].includes(role)) fail('role_unknown');
  await ensureProfile(userId, {}, { db });
  const result = await db.query(
    'UPDATE social_profiles SET role=$2, updated_at=now() WHERE user_id=$1 RETURNING user_id, display_name, role',
    [userId, role]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Снимок прогресса
// ---------------------------------------------------------------------------

async function getState(userId, { db = pool } = {}) {
  const result = await db.query('SELECT data, revision, updated_at FROM social_states WHERE user_id=$1', [userId]);
  if (!result.rowCount) return { exists: false, state: null, revision: 0, updatedAt: null, serverTime: Date.now() };
  const row = result.rows[0];
  return {
    exists: true,
    state: row.data,
    revision: Number(row.revision),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    serverTime: Date.now(),
  };
}

// Оптимистическая запись. Конфликт — не ошибка приложения, а нормальная жизнь
// двух устройств: возвращаем актуальный снимок, клиент сливает его по стабильным
// ID и присылает снова. Молча затирать чужую работу нельзя — именно так теряется
// вечер занятий на втором телефоне.
async function putState(userId, state, baseRevision, { db = pool } = {}) {
  const serialized = JSON.stringify(state);
  const inserted = await db.query(
    `INSERT INTO social_states(user_id, data, revision)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id) DO UPDATE SET
       data = EXCLUDED.data,
       revision = social_states.revision + 1,
       updated_at = now()
     WHERE social_states.revision = $3
     RETURNING revision, updated_at`,
    [userId, serialized, baseRevision]);

  if (inserted.rowCount) {
    return { ok: true, revision: Number(inserted.rows[0].revision), serverTime: Date.now() };
  }
  // Пустой RETURNING означает ровно одно: строка есть, но её revision другой.
  const current = await getState(userId, { db });
  return { ok: false, conflict: true, ...current };
}

// ---------------------------------------------------------------------------
// События попыток
// ---------------------------------------------------------------------------

// ⚠️ Порядок важен. Сначала вставляем события с ON CONFLICT DO NOTHING — только
// РЕАЛЬНО принятые строки идут в рейтинг и в пересчёт ДЗ. Повторная доставка той
// же очереди (потерянный ответ, перезапуск приложения, второе устройство с той же
// историей) не добавляет ни балла: PRIMARY KEY по event_id отсекает её в базе.
async function insertEvents(client, userId, events) {
  const accepted = [];
  for (const event of events) {
    const result = await client.query(
      `INSERT INTO social_attempt_events(
         event_id, user_id, task_id, task_type, block_ids, topic_codes, has_images,
         correct, earned, possible, elapsed_ms, kind, exam_line, attempted_at, msk_day, week_start,
         given_answer)
       VALUES ($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.eventId, userId, event.taskId, event.taskType, event.blockIds, event.topicCodes,
        event.hasImages, event.correct, event.earned, event.possible, event.elapsedMs,
        event.kind, event.examLine, new Date(event.attemptedAt).toISOString(), event.mskDay, event.weekStart,
        event.givenAnswer || '']);
    if (result.rowCount) accepted.push(event);
  }
  return accepted;
}

async function addWeeklyScores(client, userId, events) {
  const byWeek = new Map();
  for (const event of events) {
    const current = byWeek.get(event.weekStart) || { points: 0, questions: 0 };
    current.points += event.earned;
    current.questions += 1;
    byWeek.set(event.weekStart, current);
  }
  for (const [weekStart, totals] of byWeek) {
    await client.query(
      `INSERT INTO social_weekly_scores(user_id, week_start, points, questions)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, week_start) DO UPDATE SET
         points = social_weekly_scores.points + EXCLUDED.points,
         questions = social_weekly_scores.questions + EXCLUDED.questions,
         updated_at = now()`,
      [userId, weekStart, totals.points, totals.questions]);
  }
}

// Активные ДЗ ученика: только его классы, только невыданное задним числом.
async function activeAssignmentsFor(client, userId) {
  const result = await client.query(
    `SELECT a.id, a.types, a.blocks, a.topics, a.question_goal, a.include_images, a.issued_at, a.due_at, a.title, a.class_id,
            a.source, COALESCE(t.ids, ARRAY[]::text[]) AS task_ids
     FROM social_assignments a
     JOIN social_class_members m ON m.class_id = a.class_id AND m.user_id = $1 AND m.status = 'active'
     JOIN social_classes c ON c.id = a.class_id AND c.status = 'active'
     LEFT JOIN LATERAL (
       SELECT array_agg(COALESCE(at.custom_task_id::text, at.bank_task_id)) AS ids
       FROM social_assignment_tasks at WHERE at.assignment_id = a.id
     ) t ON true
     WHERE a.status = 'active'`,
    [userId]);
  return result.rows;
}

// 🔴 Пересчёт выполнения ДЗ. Считаем ПЕРВУЮ попытку по каждому заданию после
// выдачи (DISTINCT ON ... ORDER BY attempted_at):
//   * дедупликация по стабильному ID — задание с двумя темами КЭС не может
//     закрыть цель дважды;
//   * пересдача до победного не накручивает баллы — учитель видит, как ученик
//     решил, а не сколько раз повторил;
//   * повторная доставка события физически невозможна (event_id — PK), поэтому
//     кэш и пересчёт всегда сходятся.
// Суммы клиента при этом не используются вообще: источник — таблица событий.
async function recomputeAssignment(client, assignment, userId) {
  const result = await client.query(
    `INSERT INTO social_assignment_progress(assignment_id, user_id, earned, possible, questions, status, updated_at, completed_at)
     SELECT $1, $2,
            COALESCE(SUM(d.earned), 0)::int,
            COALESCE(SUM(d.possible), 0)::int,
            COUNT(*)::int,
            CASE WHEN COUNT(*) >= $3 THEN 'done' ELSE 'active' END,
            now(),
            CASE WHEN COUNT(*) >= $3 THEN now() ELSE NULL END
     FROM (
       SELECT DISTINCT ON (e.task_id) e.task_id, e.earned, e.possible
       FROM social_attempt_events e
       WHERE e.user_id = $2
         AND e.attempted_at >= $4
         AND (cardinality($5::text[]) = 0 OR e.task_type = ANY($5::text[]))
         AND (cardinality($6::text[]) = 0 OR e.block_ids && $6::text[])
         AND (cardinality($7::text[]) = 0 OR e.topic_codes && $7::text[])
         AND ($8::boolean OR e.has_images = false)
         -- Вариант учителя: засчитываются РОВНО его задания. У обычного ДЗ
         -- список пуст, и условие не влияет ни на что.
         AND (cardinality($9::text[]) = 0 OR e.task_id = ANY($9::text[]))
       ORDER BY e.task_id, e.attempted_at
     ) d
     ON CONFLICT (assignment_id, user_id) DO UPDATE SET
       earned = EXCLUDED.earned,
       possible = EXCLUDED.possible,
       questions = EXCLUDED.questions,
       status = EXCLUDED.status,
       updated_at = now(),
       completed_at = COALESCE(social_assignment_progress.completed_at, EXCLUDED.completed_at)
     RETURNING earned, possible, questions, status, completed_at`,
    [assignment.id, userId, assignment.question_goal, assignment.issued_at,
      assignment.types || [], assignment.blocks || [], assignment.topics || [], assignment.include_images,
      assignment.task_ids || []]);
  return result.rows[0];
}

async function saveAttempts(userId, events, { db = pool, transact = tx } = {}) {
  return transact(async client => {
    const accepted = await insertEvents(client, userId, events);
    if (!accepted.length) {
      return { accepted: 0, duplicates: events.length, assignments: [] };
    }
    await addWeeklyScores(client, userId, accepted);
    const assignments = await activeAssignmentsFor(client, userId);
    const touched = [];
    for (const assignment of assignments) {
      const progress = await recomputeAssignment(client, assignment, userId);
      if (!progress) continue;
      touched.push({
        assignmentId: assignment.id,
        title: assignment.title,
        earned: numeric(progress.earned),
        possible: numeric(progress.possible),
        questions: numeric(progress.questions),
        questionGoal: numeric(assignment.question_goal),
        status: progress.status,
        completedAt: progress.completed_at ? new Date(progress.completed_at).getTime() : null,
      });
    }
    return { accepted: accepted.length, duplicates: events.length - accepted.length, assignments: touched };
  });
}

// ---------------------------------------------------------------------------
// Квота
// ---------------------------------------------------------------------------

// Отдельный счётчик предмета. История и обществознание не должны съедать лимит
// друг у друга: это два разных предмета и два разных занятия.
//
// ⚠️ Честная граница ровно та же, что в квоте истории: весь банк заданий уже
// лежит в браузере, «я решил N вопросов» — утверждение клиента. Сервер держит
// источником правды сам ЛИМИТ и закрывает обход в один клик, но не мешает тому,
// кто правит JS. Продавать «больше вопросов в день» на этом основании нельзя.
async function quotaState(userId, { db = pool, kind = 'questions', limits = {} } = {}) {
  const [role, counter] = await Promise.all([
    roleOf(userId, { db }),
    db.query(`SELECT
        COALESCE((SELECT count FROM social_usage_counters
                  WHERE user_id=$1 AND day=${MOSCOW_TODAY} AND kind=$2), 0) AS used,
        ((${MOSCOW_TODAY} + 1) AT TIME ZONE 'Europe/Moscow') AS reset_at`,
      [userId, kind]),
  ]);
  const staff = role === 'teacher' || role === 'admin';
  // 0 = безлимит. Пока в обществознании нет платежей, тариф один и берётся из
  // серверной настройки; когда появятся — источником станет таблица подписок,
  // а не поле в профиле (ту ошибку в истории уже проходили).
  const limit = staff ? 0 : numeric(limits.freeDaily);
  const used = numeric(counter.rows[0].used);
  return {
    limit,
    used,
    left: limit > 0 ? Math.max(0, limit - used) : null,
    staff,
    role,
    resetAt: new Date(counter.rows[0].reset_at).getTime(),
  };
}

async function consumeQuota(userId, amount, { db = pool, kind = 'questions', limits = {} } = {}) {
  const state = await quotaState(userId, { db, kind, limits });
  if (state.limit <= 0) return { ...state, ok: true };
  // Инкремент и проверка лимита — ОДНИМ оператором: две вкладки не должны
  // проскочить обе. Пустой RETURNING и есть отказ.
  const updated = await db.query(
    `INSERT INTO social_usage_counters(user_id, day, kind, count)
     VALUES ($1, ${MOSCOW_TODAY}, $2, $3)
     ON CONFLICT (user_id, day, kind)
     DO UPDATE SET count = social_usage_counters.count + EXCLUDED.count, updated_at = now()
     WHERE social_usage_counters.count < $4
     RETURNING count`,
    [userId, kind, amount, state.limit]);
  if (!updated.rowCount) return { ...state, ok: false, used: state.limit, left: 0 };
  const used = numeric(updated.rows[0].count);
  return { ...state, ok: true, used, left: Math.max(0, state.limit - used) };
}

// ---------------------------------------------------------------------------
// Рейтинг
// ---------------------------------------------------------------------------

// Наружу уходит сокращённое имя и два числа. Полное ФИО, класс и идентификаторы
// в рейтинге не показываются никому — правило то же, что в истории.
async function weeklyLeaderboard(userId, { db = pool, limit = 20, classId = null, weekStart = null } = {}) {
  const week = weekStart || mondayStr();
  const params = [week, Math.min(50, Math.max(1, limit))];
  let sql = `SELECT w.user_id, w.points, w.questions, COALESCE(p.display_name, '') AS display_name
             FROM social_weekly_scores w
             LEFT JOIN social_profiles p ON p.user_id = w.user_id
             WHERE w.week_start = $1 AND w.points > 0`;
  if (classId) {
    params.push(classId);
    sql += ` AND EXISTS (SELECT 1 FROM social_class_members m
                         WHERE m.class_id = $3 AND m.user_id = w.user_id AND m.status = 'active')`;
  }
  sql += ' ORDER BY w.points DESC, w.questions ASC LIMIT $2';
  const result = await db.query(sql, params);
  return {
    weekStart: week,
    rows: result.rows.map((row, index) => ({
      rank: index + 1,
      displayName: leaderboardName(row.display_name),
      points: numeric(row.points),
      questions: numeric(row.questions),
      you: String(row.user_id) === String(userId),
    })),
  };
}

// ---------------------------------------------------------------------------
// Классы
// ---------------------------------------------------------------------------

function randomJoinCode() {
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (const byte of bytes) code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
  return code;
}

// Уникальность кода держит база (social_classes_join_code_uq). Коллизия на
// 32^8 маловероятна, но «маловероятна» — не «невозможна», а попадание в чужой
// класс по совпавшему коду это чужие ФИО на экране. Поэтому повторяем.
async function withUniqueJoinCode(db, apply) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await apply(randomJoinCode());
    } catch (error) {
      if (error && error.code === '23505' && attempt < 5) continue;
      throw error;
    }
  }
  return fail('join_code_generation_failed', 500);
}

async function createClass(teacherUserId, { title }, { db = pool } = {}) {
  return withUniqueJoinCode(db, async code => {
    const result = await db.query(
      `INSERT INTO social_classes(teacher_user_id, title, join_code)
       VALUES ($1,$2,$3)
       RETURNING id, title, join_code, status, created_at`,
      [teacherUserId, title, code]);
    return result.rows[0];
  });
}

async function listClasses(teacherUserId, { db = pool } = {}) {
  const result = await db.query(
    `SELECT c.id, c.title, c.join_code, c.status, c.created_at,
            (SELECT COUNT(*) FROM social_class_members m WHERE m.class_id = c.id AND m.status='active') AS students
     FROM social_classes c
     WHERE c.teacher_user_id = $1
     ORDER BY c.created_at DESC`,
    [teacherUserId]);
  return result.rows.map(row => ({
    id: row.id,
    title: row.title,
    joinCode: row.join_code,
    status: row.status,
    students: numeric(row.students),
    createdAt: new Date(row.created_at).getTime(),
  }));
}

// 🔴 Владение классом проверяется ОДНИМ запросом вместе с чтением: «взять класс,
// потом сравнить учителя» — это два шага, между которыми легко забыть второй.
// Не нашли строку по паре (id, teacher_user_id) — значит класс чужой или его нет,
// и в обоих случаях ответ одинаковый: 404. Разный ответ выдал бы посторонним сам
// факт существования класса.
async function ownedClass(teacherUserId, classId, { db = pool } = {}) {
  const result = await db.query(
    'SELECT id, title, join_code, status, teacher_user_id FROM social_classes WHERE id=$1 AND teacher_user_id=$2',
    [classId, teacherUserId]);
  if (!result.rowCount) fail('class_not_found', 404);
  return result.rows[0];
}

async function updateClass(teacherUserId, classId, patch, { db = pool } = {}) {
  await ownedClass(teacherUserId, classId, { db });
  const result = await db.query(
    `UPDATE social_classes SET
       title = COALESCE($3, title),
       status = COALESCE($4, status),
       archived_at = CASE WHEN $4 = 'archived' THEN now() ELSE archived_at END,
       updated_at = now()
     WHERE id=$1 AND teacher_user_id=$2
     RETURNING id, title, join_code, status`,
    [classId, teacherUserId, patch.title ?? null, patch.status ?? null]);
  return result.rows[0];
}

async function rotateJoinCode(teacherUserId, classId, { db = pool } = {}) {
  await ownedClass(teacherUserId, classId, { db });
  return withUniqueJoinCode(db, async code => {
    const result = await db.query(
      'UPDATE social_classes SET join_code=$3, updated_at=now() WHERE id=$1 AND teacher_user_id=$2 RETURNING id, join_code',
      [classId, teacherUserId, code]);
    return result.rows[0];
  });
}

// Учителю отдаём агрегаты, а не состояние ученика. Полного снимка прогресса
// здесь нет и появиться не должно: план запрещает учителю читать и тем более
// перезаписывать state ученика.
async function classStudents(teacherUserId, classId, { db = pool, weekStart = null } = {}) {
  await ownedClass(teacherUserId, classId, { db });
  const week = weekStart || mondayStr();
  const result = await db.query(
    `SELECT m.user_id, m.joined_at, COALESCE(p.display_name,'') AS display_name,
            COALESCE(w.points,0) AS weekly_points, COALESCE(w.questions,0) AS weekly_questions
     FROM social_class_members m
     LEFT JOIN social_profiles p ON p.user_id = m.user_id
     LEFT JOIN social_weekly_scores w ON w.user_id = m.user_id AND w.week_start = $2
     WHERE m.class_id = $1 AND m.status = 'active'
     ORDER BY p.display_name NULLS LAST, m.joined_at`,
    [classId, week]);
  return result.rows.map(row => ({
    studentId: row.user_id,
    displayName: row.display_name || 'Без имени',
    joinedAt: new Date(row.joined_at).getTime(),
    weeklyPoints: numeric(row.weekly_points),
    weeklyQuestions: numeric(row.weekly_questions),
  }));
}

// Присоединение ученика по коду. Ученик НЕ выбирает класс по идентификатору:
// код знает только тот, кому его дал учитель, а идентификатор класса можно было
// бы подобрать. Архивный класс не принимает новых.
async function joinClass(userId, code, { db = pool } = {}) {
  const found = await db.query(
    "SELECT id, title, teacher_user_id FROM social_classes WHERE join_code=$1 AND status='active'", [code]);
  if (!found.rowCount) fail('class_not_found', 404);
  const klass = found.rows[0];
  if (String(klass.teacher_user_id) === String(userId)) fail('teacher_cannot_join_own_class', 409);
  await db.query(
    `INSERT INTO social_class_members(class_id, user_id, status)
     VALUES ($1,$2,'active')
     ON CONFLICT (class_id, user_id) DO UPDATE SET status='active', updated_at=now()`,
    [klass.id, userId]);
  return { classId: klass.id, title: klass.title };
}

async function myClasses(userId, { db = pool } = {}) {
  const result = await db.query(
    `SELECT c.id, c.title, c.status, m.joined_at
     FROM social_class_members m
     JOIN social_classes c ON c.id = m.class_id
     WHERE m.user_id = $1 AND m.status = 'active'
     ORDER BY m.joined_at DESC`,
    [userId]);
  return result.rows.map(row => ({
    id: row.id,
    title: row.title,
    status: row.status,
    joinedAt: new Date(row.joined_at).getTime(),
  }));
}

// ---------------------------------------------------------------------------
// Домашние задания
// ---------------------------------------------------------------------------

// Выдача ДЗ. Вариант учителя пишется в ОДНОЙ транзакции с составом: задание без
// состава — это домашка, которую нельзя выполнить, и ученик увидел бы «0 из 5»
// без единого вопроса.
async function createAssignment(teacherUserId, data, { db = pool, transact = tx } = {}) {
  await ownedClass(teacherUserId, data.classId, { db });
  if (data.source !== 'custom') {
    const result = await db.query(
      `INSERT INTO social_assignments(class_id, teacher_user_id, title, types, blocks, topics, question_goal, include_images, due_at, source)
       VALUES ($1,$2,$3,$4::text[],$5::text[],$6::text[],$7,$8,$9,'bank')
       RETURNING id, class_id, title, types, blocks, topics, question_goal, include_images, due_at, status, issued_at, source`,
      [data.classId, teacherUserId, data.title, data.types, data.blocks, data.topics,
        data.questionGoal, data.includeImages, data.dueAt]);
    return assignmentForClient(result.rows[0]);
  }
  return transact(async client => {
    // Чужое задание в свой вариант не попадёт: выбираем только собственные и
    // сверяем количество. Молча выдать вариант из четырёх заданий вместо пяти
    // нельзя — учитель этого не заметит, а ученик не сможет его закрыть.
    const ownIds = data.slots.filter(slot => slot.customTaskId).map(slot => slot.customTaskId);
    if (ownIds.length) {
      const owned = await client.query(
        `SELECT id FROM social_custom_tasks
         WHERE teacher_user_id = $1 AND status = 'active' AND id = ANY($2::uuid[])`,
        [teacherUserId, ownIds]);
      if (owned.rowCount !== ownIds.length) fail('task_not_found', 404);
    }
    const created = await client.query(
      `INSERT INTO social_assignments(class_id, teacher_user_id, title, types, blocks, topics, question_goal, include_images, due_at, source)
       VALUES ($1,$2,$3,'{}'::text[],'{}'::text[],'{}'::text[],$4,false,$5,'custom')
       RETURNING id, class_id, title, types, blocks, topics, question_goal, include_images, due_at, status, issued_at, source`,
      [data.classId, teacherUserId, data.title, data.questionGoal, data.dueAt]);
    const assignment = created.rows[0];
    // Порядок — это индекс в списке учителя: вариант является
    // последовательностью, а не мешком. Строки перечисляются явно, потому что
    // позиция каждой равна её месту в присланном массиве.
    //
    // 🔴 Задание банка ФИПИ хранится конкретным ID, а не «подставь любое при
    // выдаче». Вариант класс решает и разбирает вместе, и №9 обязан быть одним
    // и тем же у всех — иначе разбирать нечего.
    const params = [assignment.id];
    const values = data.slots.map((slot, index) => {
      const own = params.push(slot.customTaskId || null);
      const bank = params.push(slot.bankTaskId || '');
      return `($1, $${own}::uuid, ${index}, $${bank}::text, ${Number(slot.line) || 0})`;
    }).join(', ');
    await client.query(
      `INSERT INTO social_assignment_tasks(assignment_id, custom_task_id, position, bank_task_id, exam_line)
       VALUES ${values}`,
      params);
    return { ...assignmentForClient(assignment), taskIds: data.taskIds };
  });
}

// ---------------------------------------------------------------------------
// Слияние аккаунтов
// ---------------------------------------------------------------------------

// 🔴 Вызывается из mergeUsers (src/auth.js) в ЕГО транзакции.
//
// 13.08.2026: mergeUsers переносил только таблицы истории — он был написан до
// появления предмета. Любое слияние аккаунтов (вход через Google поверх
// telegram-сессии, привязка legacy-документа) молча оставляло на отключаемом
// аккаунте весь прогресс обществознания, роль учителя, классы, домашки и свои
// задания. Заметить это можно только постфактум: человек входит и видит пустой
// предмет, а данные лежат у аккаунта, которого больше нет в выдаче.
//
// Здесь же, а не в auth.js, потому что весь SQL предмета обязан жить в одном
// файле — иначе следующая таблица social_* снова окажется забытой.
async function mergeUserData(client, primaryId, secondaryId) {
  // Попытки — источник правды по баллам, у них свой первичный ключ (event_id),
  // поэтому переносятся целиком и без конфликтов.
  await client.query('UPDATE social_attempt_events SET user_id=$1 WHERE user_id=$2', [primaryId, secondaryId]);
  // Всё, что человек ведёт как учитель, переезжает без вопросов: у этих таблиц
  // владелец — одна колонка.
  for (const table of ['social_classes', 'social_assignments', 'social_custom_tasks']) {
    await client.query(`UPDATE ${table} SET teacher_user_id=$1 WHERE teacher_user_id=$2`, [primaryId, secondaryId]);
  }
  await client.query('UPDATE social_notification_jobs SET user_id=$1 WHERE user_id=$2', [primaryId, secondaryId]);

  // Профиль: роль повышаем, но никогда не понижаем. Учитель, слитый в аккаунт
  // ученика, обязан остаться учителем — иначе слияние молча отнимает доступ.
  await client.query(
    `INSERT INTO social_profiles(user_id, display_name, role, settings)
     SELECT $1, display_name, role, settings FROM social_profiles WHERE user_id=$2
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = CASE WHEN social_profiles.display_name = '' THEN EXCLUDED.display_name ELSE social_profiles.display_name END,
       role = CASE
         WHEN social_profiles.role = 'admin' OR EXCLUDED.role = 'admin' THEN 'admin'
         WHEN social_profiles.role = 'teacher' OR EXCLUDED.role = 'teacher' THEN 'teacher'
         ELSE social_profiles.role END,
       updated_at = now()`,
    [primaryId, secondaryId]);

  // Снимок прогресса переносим ТОЛЬКО если у основного аккаунта его нет. Слить
  // два блоба здесь нечем: этим занимается core.mergeProgress на клиенте, и он
  // сделает это при ближайшей синхронизации.
  await client.query(
    `INSERT INTO social_states(user_id, data, revision)
     SELECT $1, data, revision FROM social_states WHERE user_id=$2
     ON CONFLICT (user_id) DO NOTHING`,
    [primaryId, secondaryId]);

  await client.query(
    `INSERT INTO social_class_members(class_id, user_id, status, joined_at)
     SELECT class_id, $1, status, joined_at FROM social_class_members WHERE user_id=$2
     ON CONFLICT (class_id, user_id) DO UPDATE SET
       status = CASE WHEN social_class_members.status = 'active' OR EXCLUDED.status = 'active' THEN 'active' ELSE 'removed' END,
       updated_at = now()`,
    [primaryId, secondaryId]);

  // Выполнение ДЗ: берём лучшее из двух. Слияние не имеет права ухудшить уже
  // засчитанную работу — учитель увидел бы откат оценки без причины.
  await client.query(
    `INSERT INTO social_assignment_progress(assignment_id, user_id, earned, possible, questions, status, completed_at)
     SELECT assignment_id, $1, earned, possible, questions, status, completed_at
     FROM social_assignment_progress WHERE user_id=$2
     ON CONFLICT (assignment_id, user_id) DO UPDATE SET
       earned = GREATEST(social_assignment_progress.earned, EXCLUDED.earned),
       possible = GREATEST(social_assignment_progress.possible, EXCLUDED.possible),
       questions = GREATEST(social_assignment_progress.questions, EXCLUDED.questions),
       status = CASE WHEN social_assignment_progress.status = 'done' OR EXCLUDED.status = 'done' THEN 'done' ELSE 'active' END,
       completed_at = LEAST(social_assignment_progress.completed_at, EXCLUDED.completed_at),
       updated_at = now()`,
    [primaryId, secondaryId]);

  // Квота и рейтинг складываются: это работа одного человека с двух устройств,
  // а не двух разных людей.
  await client.query(
    `INSERT INTO social_usage_counters(user_id, day, kind, count)
     SELECT $1, day, kind, count FROM social_usage_counters WHERE user_id=$2
     ON CONFLICT (user_id, day, kind) DO UPDATE SET
       count = social_usage_counters.count + EXCLUDED.count, updated_at = now()`,
    [primaryId, secondaryId]);
  await client.query(
    `INSERT INTO social_weekly_scores(user_id, week_start, points, questions)
     SELECT $1, week_start, points, questions FROM social_weekly_scores WHERE user_id=$2
     ON CONFLICT (user_id, week_start) DO UPDATE SET
       points = social_weekly_scores.points + EXCLUDED.points,
       questions = social_weekly_scores.questions + EXCLUDED.questions,
       updated_at = now()`,
    [primaryId, secondaryId]);

  // Остатки на втором аккаунте удаляем явно: строки с составным ключом выше
  // копировались, а не переносились, и без этого они уехали бы в каскад при
  // следующем удалении аккаунта — то есть исчезли бы вместе с ним.
  for (const table of ['social_class_members', 'social_assignment_progress', 'social_usage_counters', 'social_weekly_scores', 'social_states', 'social_profiles']) {
    await client.query(`DELETE FROM ${table} WHERE user_id=$1`, [secondaryId]);
  }
}

// ---------------------------------------------------------------------------
// Свои задания учителя
// ---------------------------------------------------------------------------

function customTaskForClient(row, { withAnswer = true } = {}) {
  return {
    id: row.id,
    type: row.type,
    prompt: row.prompt || '',
    options: Array.isArray(row.options) ? row.options : [],
    targets: Array.isArray(row.targets) ? row.targets : [],
    ...(withAnswer ? { answer: row.answer || '' } : {}),
    blocks: row.blocks || [],
    topics: row.topics || [],
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

// Строка варианта глазами клиента. Задание ФИПИ уезжает одним идентификатором:
// весь банк уже лежит в приложении ученика, и присылать текст задания второй
// раз незачем — а на сервере его и нет.
//
// 🔴 Форма ответа одна и та же для обоих источников: у строки всегда есть id,
// examLine и source. Приложение решает по source, где взять содержимое.
function variantSlotForClient(row) {
  const examLine = numeric(row.exam_line);
  if (row.bank_task_id) {
    return { id: row.bank_task_id, source: 'bank', examLine };
  }
  return { ...customTaskForClient(row), source: 'custom', examLine };
}

async function listCustomTasks(teacherUserId, { db = pool, includeArchived = false } = {}) {
  const result = await db.query(
    `SELECT id, type, prompt, options, targets, answer, blocks, topics, status, created_at
     FROM social_custom_tasks
     WHERE teacher_user_id = $1 AND ($2::boolean OR status = 'active')
     ORDER BY created_at DESC LIMIT 500`,
    [teacherUserId, includeArchived]);
  return result.rows.map(row => customTaskForClient(row));
}

async function createCustomTask(teacherUserId, data, { db = pool } = {}) {
  const result = await db.query(
    `INSERT INTO social_custom_tasks(teacher_user_id, type, prompt, options, targets, answer, blocks, topics)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::text[],$8::text[])
     RETURNING id, type, prompt, options, targets, answer, blocks, topics, status, created_at`,
    [teacherUserId, data.type, data.prompt, JSON.stringify(data.options), JSON.stringify(data.targets),
      data.answer, data.blocks, data.topics]);
  return customTaskForClient(result.rows[0]);
}

async function updateCustomTask(teacherUserId, taskId, data, { db = pool } = {}) {
  const result = await db.query(
    `UPDATE social_custom_tasks
     SET type=$3, prompt=$4, options=$5::jsonb, targets=$6::jsonb, answer=$7, blocks=$8::text[], topics=$9::text[], updated_at=now()
     WHERE id=$1 AND teacher_user_id=$2 AND status='active'
     RETURNING id, type, prompt, options, targets, answer, blocks, topics, status, created_at`,
    [taskId, teacherUserId, data.type, data.prompt, JSON.stringify(data.options), JSON.stringify(data.targets),
      data.answer, data.blocks, data.topics]);
  if (!result.rowCount) fail('task_not_found', 404);
  return customTaskForClient(result.rows[0]);
}

// Задание не удаляется, а архивируется. Удаление сняло бы его и с уже выданных
// вариантов (ON DELETE CASCADE в составе), то есть переписало бы прошлую
// домашку задним числом.
async function archiveCustomTask(teacherUserId, taskId, { db = pool } = {}) {
  const result = await db.query(
    `UPDATE social_custom_tasks SET status='archived', updated_at=now()
     WHERE id=$1 AND teacher_user_id=$2 RETURNING id, status`,
    [taskId, teacherUserId]);
  if (!result.rowCount) fail('task_not_found', 404);
  return { id: result.rows[0].id, status: result.rows[0].status };
}

// Задания варианта глазами ученика. Доступ — только участнику класса, которому
// это ДЗ выдано: иначе по идентификатору чужого задания вытягивался бы весь
// чужой вариант вместе с ответами.
async function assignmentTasksForStudent(userId, assignmentId, { db = pool } = {}) {
  const result = await db.query(
    `SELECT at.bank_task_id, at.exam_line,
            t.id, t.type, t.prompt, t.options, t.targets, t.answer, t.blocks, t.topics, t.status, t.created_at
     FROM social_assignment_tasks at
     JOIN social_assignments a ON a.id = at.assignment_id AND a.status = 'active'
     JOIN social_classes c ON c.id = a.class_id AND c.status = 'active'
     JOIN social_class_members m ON m.class_id = a.class_id AND m.user_id = $1 AND m.status = 'active'
     LEFT JOIN social_custom_tasks t ON t.id = at.custom_task_id
     WHERE at.assignment_id = $2
     ORDER BY at.position`,
    [userId, assignmentId]);
  if (!result.rowCount) fail('assignment_not_found', 404);
  return result.rows.map(row => variantSlotForClient(row));
}

// Те же задания для учителя — чтобы кабинет показывал состав выданного варианта.
async function assignmentTasksForTeacher(teacherUserId, assignmentId, { db = pool } = {}) {
  await ownedAssignment(teacherUserId, assignmentId, { db });
  const result = await db.query(
    `SELECT at.bank_task_id, at.exam_line,
            t.id, t.type, t.prompt, t.options, t.targets, t.answer, t.blocks, t.topics, t.status, t.created_at
     FROM social_assignment_tasks at
     LEFT JOIN social_custom_tasks t ON t.id = at.custom_task_id
     WHERE at.assignment_id = $1
     ORDER BY at.position`,
    [assignmentId]);
  return result.rows.map(row => variantSlotForClient(row));
}

function assignmentForClient(row) {
  return {
    id: row.id,
    classId: row.class_id,
    // Источник нужен клиенту: у варианта учителя задания приходят с сервера, а
    // не собираются из локального банка ФИПИ.
    source: row.source === 'custom' ? 'custom' : 'bank',
    title: row.title || '',
    types: row.types || [],
    blocks: row.blocks || [],
    topics: row.topics || [],
    questionGoal: numeric(row.question_goal),
    includeImages: Boolean(row.include_images),
    dueAt: row.due_at ? new Date(row.due_at).getTime() : null,
    status: row.status,
    issuedAt: row.issued_at ? new Date(row.issued_at).getTime() : null,
  };
}

async function ownedAssignment(teacherUserId, assignmentId, { db = pool } = {}) {
  const result = await db.query(
    `SELECT id, class_id, teacher_user_id, title, types, blocks, topics, question_goal,
            include_images, due_at, status, issued_at, source
     FROM social_assignments WHERE id=$1 AND teacher_user_id=$2`,
    [assignmentId, teacherUserId]);
  if (!result.rowCount) fail('assignment_not_found', 404);
  return result.rows[0];
}

async function listAssignments(teacherUserId, { db = pool, classId = null } = {}) {
  const params = [teacherUserId];
  let sql = `SELECT a.id, a.class_id, a.title, a.types, a.blocks, a.topics, a.question_goal,
                    a.include_images, a.due_at, a.status, a.issued_at, a.source,
                    (SELECT COUNT(*) FROM social_assignment_progress p
                      WHERE p.assignment_id = a.id AND p.status='done') AS done_count,
                    (SELECT COUNT(*) FROM social_class_members m
                      WHERE m.class_id = a.class_id AND m.status='active') AS student_count
             FROM social_assignments a
             WHERE a.teacher_user_id = $1`;
  if (classId) {
    params.push(classId);
    sql += ' AND a.class_id = $2';
  }
  sql += ' ORDER BY a.issued_at DESC LIMIT 200';
  const result = await db.query(sql, params);
  return result.rows.map(row => ({
    ...assignmentForClient(row),
    doneCount: numeric(row.done_count),
    studentCount: numeric(row.student_count),
  }));
}

async function updateAssignment(teacherUserId, assignmentId, patch, { db = pool } = {}) {
  const current = await ownedAssignment(teacherUserId, assignmentId, { db });
  const result = await db.query(
    `UPDATE social_assignments SET
       title = COALESCE($3, title),
       question_goal = COALESCE($4, question_goal),
       due_at = CASE WHEN $5 THEN $6 ELSE due_at END,
       status = COALESCE($7, status),
       updated_at = now()
     WHERE id=$1 AND teacher_user_id=$2
     RETURNING id, class_id, title, types, blocks, topics, question_goal, include_images, due_at, status, issued_at`,
    [assignmentId, teacherUserId, patch.title ?? null, patch.questionGoal ?? null,
      'dueAt' in patch, patch.dueAt ?? null, patch.status ?? null]);
  // Цель могла измениться — пересчитываем статус «сдано» у всех, иначе ученик,
  // уже перешагнувший новую цель, остался бы в списке должников.
  if (patch.questionGoal && patch.questionGoal !== current.question_goal) {
    await db.query(
      `UPDATE social_assignment_progress SET
         status = CASE WHEN questions >= $2 THEN 'done' ELSE 'active' END,
         completed_at = CASE WHEN questions >= $2 THEN COALESCE(completed_at, now()) ELSE NULL END,
         updated_at = now()
       WHERE assignment_id = $1`,
      [assignmentId, patch.questionGoal]);
  }
  return assignmentForClient(result.rows[0]);
}

// Отмена, а не удаление: событиям и их баллам ничего не делается, задание просто
// перестаёт быть активным. Стереть выполнение ученика учитель не может.
async function cancelAssignment(teacherUserId, assignmentId, { db = pool } = {}) {
  await ownedAssignment(teacherUserId, assignmentId, { db });
  const result = await db.query(
    "UPDATE social_assignments SET status='cancelled', updated_at=now() WHERE id=$1 AND teacher_user_id=$2 RETURNING id, status",
    [assignmentId, teacherUserId]);
  return result.rows[0];
}

// Результаты ДЗ: баллы и выполнение по каждому ученику класса, включая тех, кто
// не начинал (LEFT JOIN) — «никто не приступил» и «никого нет в классе» это
// разные вещи, и учитель должен их различать.
async function assignmentResults(teacherUserId, assignmentId, { db = pool } = {}) {
  const assignment = await ownedAssignment(teacherUserId, assignmentId, { db });
  const result = await db.query(
    `SELECT m.user_id, COALESCE(p.display_name,'') AS display_name,
            COALESCE(pr.earned,0) AS earned, COALESCE(pr.possible,0) AS possible,
            COALESCE(pr.questions,0) AS questions, COALESCE(pr.status,'active') AS status,
            pr.completed_at
     FROM social_class_members m
     LEFT JOIN social_profiles p ON p.user_id = m.user_id
     LEFT JOIN social_assignment_progress pr ON pr.assignment_id = $2 AND pr.user_id = m.user_id
     WHERE m.class_id = $1 AND m.status = 'active'
     ORDER BY COALESCE(pr.questions,0) DESC, p.display_name NULLS LAST`,
    [assignment.class_id, assignmentId]);
  return {
    assignment: assignmentForClient(assignment),
    results: result.rows.map(row => {
      const possible = numeric(row.possible);
      const earned = numeric(row.earned);
      return {
        studentId: row.user_id,
        displayName: row.display_name || 'Без имени',
        earned,
        possible,
        // Процент считается только как earned/possible — так же, как во всей
        // статистике предмета. Частичный балл соответствия обязан быть виден.
        percent: possible > 0 ? Math.round((earned / possible) * 100) : 0,
        questions: numeric(row.questions),
        status: row.status,
        completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
        onTime: row.completed_at && assignment.due_at
          ? new Date(row.completed_at).getTime() <= new Date(assignment.due_at).getTime()
          : null,
      };
    }),
  };
}

// Разбор домашки по одному ученику: какие задания зачтены, что из этого верно
// и сколько времени ушло. Итог в таблице результатов отвечает «сколько», а
// учителю нужно «что именно не получилось» — без этого он видит процент и не
// знает, объяснять ли тему заново.
//
// 🔴 Выборка обязана повторять правило зачёта из recomputeAssignment: ПЕРВАЯ
// попытка по каждому заданию после выдачи, с теми же фильтрами. Иначе разбор
// покажет одно, а колонка «Баллы» — другое, и доверия не будет ни к тому, ни к
// другому.
async function assignmentStudentDetail(teacherUserId, assignmentId, studentUserId, { db = pool } = {}) {
  const assignment = await ownedAssignment(teacherUserId, assignmentId, { db });
  const member = await db.query(
    `SELECT m.user_id, COALESCE(p.display_name,'') AS display_name
     FROM social_class_members m
     LEFT JOIN social_profiles p ON p.user_id = m.user_id
     WHERE m.class_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [assignment.class_id, studentUserId]);
  if (!member.rowCount) {
    const error = new Error('student_not_found');
    error.statusCode = 404;
    error.code = 'student_not_found';
    throw error;
  }
  const attempts = await db.query(
    `SELECT DISTINCT ON (e.task_id) e.task_id, e.task_type, e.exam_line, e.topic_codes, e.block_ids,
            e.correct, e.earned, e.possible, e.elapsed_ms, e.attempted_at, e.given_answer
     FROM social_attempt_events e
     WHERE e.user_id = $1
       AND e.attempted_at >= $2
       AND (cardinality($3::text[]) = 0 OR e.task_type = ANY($3::text[]))
       AND (cardinality($4::text[]) = 0 OR e.block_ids && $4::text[])
       AND (cardinality($5::text[]) = 0 OR e.topic_codes && $5::text[])
       AND ($6::boolean OR e.has_images = false)
       AND (cardinality($7::text[]) = 0 OR e.task_id = ANY($7::text[]))
     ORDER BY e.task_id, e.attempted_at`,
    [studentUserId, assignment.issued_at, assignment.types || [], assignment.blocks || [],
      assignment.topics || [], assignment.include_images, assignment.task_ids || []]);
  const rows = attempts.rows.map(row => ({
    taskId: row.task_id,
    taskType: row.task_type,
    examLine: numeric(row.exam_line),
    topicCodes: row.topic_codes || [],
    blockIds: row.block_ids || [],
    correct: row.correct === true,
    earned: numeric(row.earned),
    possible: numeric(row.possible),
    elapsedMs: numeric(row.elapsed_ms),
    attemptedAt: row.attempted_at ? new Date(row.attempted_at).getTime() : null,
    // Пусто у попыток, сделанных до появления колонки: восстановить их неоткуда,
    // и кабинет обязан сказать «ответ не сохранён», а не показать пустоту.
    givenAnswer: row.given_answer || '',
  }));
  // Порядок — по времени ответа: учителю важна последовательность занятия, а не
  // алфавит идентификаторов, по которому шла выборка первой попытки.
  rows.sort((a, b) => (a.attemptedAt || 0) - (b.attemptedAt || 0));
  const spent = rows.reduce((sum, row) => sum + row.elapsedMs, 0);
  return {
    assignment: assignmentForClient(assignment),
    student: { studentId: studentUserId, displayName: member.rows[0].display_name || 'Без имени' },
    attempts: rows,
    totals: {
      questions: rows.length,
      wrong: rows.filter(row => !row.correct).length,
      earned: rows.reduce((sum, row) => sum + row.earned, 0),
      possible: rows.reduce((sum, row) => sum + row.possible, 0),
      elapsedMs: spent,
      // Медиана, а не среднее: одна вкладка, забытая открытой на полчаса, сдвигает
      // среднее так, что число перестаёт что-либо значить.
      medianMs: rows.length
        ? [...rows].map(row => row.elapsedMs).sort((a, b) => a - b)[Math.floor(rows.length / 2)]
        : 0,
      firstAt: rows.length ? rows[0].attemptedAt : null,
      lastAt: rows.length ? rows[rows.length - 1].attemptedAt : null,
    },
  };
}

// ДЗ глазами ученика: активные и завершённые, с собственным прогрессом. Чужих
// результатов здесь нет — ученик видит только свою строку.
//
// 🔴 countedTaskIds — не украшение, а условие того, что домашка вообще работает.
// В зачёт идёт ПЕРВАЯ попытка по каждому заданию после выдачи (см.
// recomputeAssignment). Без списка уже зачтённых заданий клиент собрал бы
// занятие из того же самого — ученик решает, а счётчик стоит на месте, и понять
// причину невозможно: приложение показывает «4 из 12» и после десяти ответов.
async function studentAssignments(userId, { db = pool } = {}) {
  const result = await db.query(
    `SELECT a.id, a.class_id, a.title, a.types, a.blocks, a.topics, a.question_goal,
            a.include_images, a.due_at, a.status, a.issued_at, a.source,
            c.title AS class_title,
            COALESCE(pr.earned,0) AS earned, COALESCE(pr.possible,0) AS possible,
            COALESCE(pr.questions,0) AS questions, COALESCE(pr.status,'active') AS progress_status,
            pr.completed_at,
            COALESCE(counted.ids, ARRAY[]::text[]) AS counted_ids,
            COALESCE(own.ids, ARRAY[]::text[]) AS task_ids
     FROM social_assignments a
     JOIN social_classes c ON c.id = a.class_id AND c.status='active'
     JOIN social_class_members m ON m.class_id = a.class_id AND m.user_id = $1 AND m.status='active'
     LEFT JOIN social_assignment_progress pr ON pr.assignment_id = a.id AND pr.user_id = $1
     LEFT JOIN LATERAL (
       SELECT array_agg(at.custom_task_id::text) AS ids
       FROM social_assignment_tasks at WHERE at.assignment_id = a.id
     ) own ON true
     LEFT JOIN LATERAL (
       SELECT array_agg(DISTINCT e.task_id) AS ids
       FROM social_attempt_events e
       WHERE e.user_id = $1
         AND e.attempted_at >= a.issued_at
         AND (cardinality(a.types) = 0 OR e.task_type = ANY(a.types))
         AND (cardinality(a.blocks) = 0 OR e.block_ids && a.blocks)
         AND (cardinality(a.topics) = 0 OR e.topic_codes && a.topics)
         AND (a.include_images OR e.has_images = false)
         AND (own.ids IS NULL OR e.task_id = ANY(own.ids))
     ) counted ON true
     WHERE a.status = 'active'
     ORDER BY a.issued_at DESC LIMIT 100`,
    [userId]);
  return result.rows.map(row => ({
    ...assignmentForClient(row),
    classTitle: row.class_title || '',
    countedTaskIds: Array.isArray(row.counted_ids) ? row.counted_ids : [],
    taskIds: Array.isArray(row.task_ids) ? row.task_ids : [],
    progress: {
      earned: numeric(row.earned),
      possible: numeric(row.possible),
      questions: numeric(row.questions),
      status: row.progress_status,
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
    },
  }));
}

// ---------------------------------------------------------------------------
// Сводки для бота
// ---------------------------------------------------------------------------

// Что бот может рассказать ученику о нём самом. До этой сводки бот умел ровно
// две вещи: открыть приложение и записать в класс, а на вопрос «как у меня
// дела» отвечал именем и Telegram ID — сведениями, которые ученику не нужны.
//
// Считается по событиям попыток, а не по снимку прогресса: снимок присылает
// клиент, и доверять ему в цифрах, которые видит учитель, нельзя.
async function studentDigest(userId, { db = pool } = {}) {
  // Вклад одной попытки в «время за занятиями» ограничен десятью минутами:
  // время меряет клиент от показа задания до ответа, и забытая открытой
  // вкладка добавляла часы. На двух решённых заданиях это уже показывало час.
  const totals = await db.query(
    `SELECT COUNT(DISTINCT task_id)::int AS solved,
            COUNT(*)::int AS attempts,
            COALESCE(SUM(earned), 0)::int AS earned,
            COALESCE(SUM(possible), 0)::int AS possible,
            COALESCE(SUM(LEAST(elapsed_ms, 600000)), 0)::bigint AS elapsed_ms
     FROM social_attempt_events WHERE user_id = $1`, [userId]);
  const week = await db.query(
    `SELECT COALESCE(points, 0)::int AS points, COALESCE(questions, 0)::int AS questions
     FROM social_weekly_scores WHERE user_id = $1 AND week_start = $2`, [userId, mondayStr()]);
  // Дни активности берём списком и считаем серию в коде: месяц строк дешевле,
  // чем рекурсивный запрос, и правило «серия рвётся» видно глазами.
  const days = await db.query(
    `SELECT DISTINCT msk_day FROM social_attempt_events
     WHERE user_id = $1 AND msk_day > (now() AT TIME ZONE 'Europe/Moscow')::date - 90
     ORDER BY msk_day DESC`, [userId]);
  const today = moscowDayStr();
  let streak = 0;
  for (const row of days.rows) {
    const day = String(row.msk_day instanceof Date ? row.msk_day.toISOString().slice(0, 10) : row.msk_day);
    const expected = shiftDay(today, -streak);
    // Пропуск сегодняшнего дня серию не рвёт: человек мог ещё не сесть за
    // занятия, и обнулять счёт с утра — значит наказывать ни за что.
    if (day === expected) { streak += 1; continue; }
    if (streak === 0 && day === shiftDay(today, -1)) { streak = 1; continue; }
    break;
  }
  const row = totals.rows[0] || {};
  const possible = numeric(row.possible);
  return {
    solved: numeric(row.solved),
    attempts: numeric(row.attempts),
    earned: numeric(row.earned),
    possible,
    percent: possible > 0 ? Math.round((numeric(row.earned) / possible) * 100) : 0,
    elapsedMs: Number(row.elapsed_ms || 0),
    weekPoints: numeric((week.rows[0] || {}).points),
    weekQuestions: numeric((week.rows[0] || {}).questions),
    streak,
  };
}

function shiftDay(iso, delta) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// Что бот может рассказать учителю, не открывая кабинет: по каждой активной
// домашке — сколько человек сдали и как класс справляется. Это ровно тот
// вопрос, ради которого учитель лезет в кабинет с телефона.
async function teacherDigest(userId, { db = pool } = {}) {
  const result = await db.query(
    `SELECT a.id, a.title, a.due_at, a.question_goal, c.title AS class_title,
            (SELECT COUNT(*)::int FROM social_class_members m
             WHERE m.class_id = a.class_id AND m.status = 'active') AS students,
            (SELECT COUNT(*)::int FROM social_assignment_progress pr
             WHERE pr.assignment_id = a.id AND pr.status = 'done') AS done,
            (SELECT COALESCE(SUM(pr.earned), 0)::int FROM social_assignment_progress pr
             WHERE pr.assignment_id = a.id) AS earned,
            (SELECT COALESCE(SUM(pr.possible), 0)::int FROM social_assignment_progress pr
             WHERE pr.assignment_id = a.id) AS possible
     FROM social_assignments a
     JOIN social_classes c ON c.id = a.class_id AND c.status = 'active'
     WHERE c.teacher_user_id = $1 AND a.status = 'active'
     ORDER BY a.issued_at DESC LIMIT 20`, [userId]);
  return result.rows.map(item => {
    const possible = numeric(item.possible);
    return {
      assignmentId: item.id,
      title: item.title || 'Домашнее задание',
      classTitle: item.class_title || '',
      dueAt: item.due_at ? new Date(item.due_at).getTime() : null,
      students: numeric(item.students),
      done: numeric(item.done),
      percent: possible > 0 ? Math.round((numeric(item.earned) / possible) * 100) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Уведомления (бот обществознания)
// ---------------------------------------------------------------------------

// 🔴 ОДИН ОПЕРАТОР НА ВЕСЬ КЛАСС. Раздача уведомлений циклом по ученикам
// обрывается на первом же сбое, и вторая половина класса молча остаётся без
// домашки — это уже случалось в истории и ищется потом днями. Здесь строки для
// всех получателей создаются одним INSERT ... SELECT: либо есть все, либо нет
// ни одной, и обе ситуации видны сразу.
//
// Ученик без Telegram (вошёл через Google) в выборку не попадает — писать ему
// боту некуда. Это честное ограничение, а не потеря: домашку он увидит в
// приложении.
async function enqueueAssignmentNotifications(assignment, { db = pool } = {}) {
  const payload = {
    assignmentId: assignment.id,
    title: assignment.title || '',
    questionGoal: assignment.questionGoal,
    dueAt: assignment.dueAt || null,
    // Вариант учителя ученик узнаёт по сообщению: это не «порешай что угодно
    // из банка», а конкретные задания, которые он составил.
    source: assignment.source === 'custom' ? 'custom' : 'bank',
  };
  const result = await db.query(
    `INSERT INTO social_notification_jobs(assignment_id, user_id, telegram_id, kind, payload)
     SELECT $1, m.user_id, i.subject, 'assignment', $2::jsonb
     FROM social_class_members m
     JOIN user_identities i ON i.user_id = m.user_id AND i.provider = 'telegram'
     WHERE m.class_id = $3 AND m.status = 'active'
     ON CONFLICT (assignment_id, telegram_id) WHERE assignment_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [assignment.id, JSON.stringify(payload), assignment.classId]);
  return result.rowCount;
}

// Забор пачки ботом. `FOR UPDATE SKIP LOCKED` — чтобы два экземпляра бота (или
// перезапуск во время работы) не отправили одно и то же дважды.
async function claimNotifications(limit, { db = pool, transact = tx } = {}) {
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  return transact(async client => {
    const found = await client.query(
      `SELECT id, telegram_id, kind, payload FROM social_notification_jobs
       WHERE attempts < 5 AND next_attempt_at <= now() AND (
         status = 'pending' OR (status = 'processing' AND locked_at < now() - interval '10 minutes')
       )
       ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [size]);
    if (!found.rowCount) return [];
    await client.query(
      `UPDATE social_notification_jobs
       SET status='processing', locked_at=now(), attempts=attempts+1, updated_at=now()
       WHERE id = ANY($1::bigint[])`, [found.rows.map(row => row.id)]);
    return found.rows.map(row => ({
      id: String(row.id),
      telegramId: String(row.telegram_id),
      kind: row.kind,
      payload: row.payload || {},
    }));
  });
}

async function ackNotification(id, { db = pool } = {}) {
  await db.query(
    `UPDATE social_notification_jobs SET status='delivered', delivered_at=now(), locked_at=NULL, updated_at=now()
     WHERE id=$1 AND status='processing'`, [id]);
}

// Отказ. Растущая пауза между попытками и жёсткий потолок в пять: если человек
// не начинал диалог с ботом, Telegram не даст написать ему НИКОГДА, и вечные
// повторы только маскируют эту причину.
async function failNotification(id, error, { db = pool } = {}) {
  await db.query(
    `UPDATE social_notification_jobs SET
       status = CASE WHEN attempts < 5 THEN 'pending' ELSE 'failed' END,
       last_error = $2,
       locked_at = NULL,
       next_attempt_at = now() + CASE attempts WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes' ELSE interval '20 minutes' END,
       updated_at = now()
     WHERE id=$1 AND status='processing'`, [id, String(error || '').slice(0, 1000)]);
}

// Кто это по Telegram ID: нужно боту, который знает человека только так.
// Роль отдаём, чтобы бот мог показать учителю ссылку на кабинет и не показывать
// её ученику. Ничего, кроме имени и роли, наружу не уходит.
// Кто это по почте. Нужен, чтобы выдать роль человеку, вошедшему через Google:
// whoIs умеет искать только по telegram-личности, и для такого человека бот
// отвечал «ещё не открывал тренажёр» — неправду.
//
// 🔴 Ровно один кандидат, иначе отказ. Почта в user_identities приходит от
// провайдера, в app_users могла остаться от переноса из Firebase, и совпадений
// может оказаться несколько. Выдать роль учителя не тому человеку — это доступ
// к чужим классам, поэтому при неоднозначности лучше не сделать ничего.
// 🔴 Сначала ищем СРЕДИ УЧЕНИКОВ ОБЩЕСТВОЗНАНИЯ и только потом среди всех. База
// общая с историей: одна и та же почта живёт и там, и здесь, поэтому «ровно один
// кандидат» на общей выборке легко превращается в двух — и роль не выдаётся
// никому, хотя в обществознании человек ровно один. Запасной проход по всем
// оставлен намеренно: он позволяет выдать роль заранее, ещё до первого захода.
async function whoIsByEmail(email, { db = pool } = {}) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle || !needle.includes('@')) return null;
  const lookup = async socialOnly => {
    const result = await db.query(
      `SELECT DISTINCT u.id AS user_id, COALESCE(p.display_name, u.display_name, '') AS display_name,
              COALESCE(p.role, 'student') AS role
       FROM app_users u
       LEFT JOIN user_identities i ON i.user_id = u.id
       ${socialOnly ? 'JOIN' : 'LEFT JOIN'} social_profiles p ON p.user_id = u.id
       WHERE u.disabled_at IS NULL AND (lower(u.email) = $1 OR lower(i.email) = $1)`,
      [needle]);
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return { userId: row.user_id, displayName: row.display_name, role: row.role };
  };
  return (await lookup(true)) || lookup(false);
}

// Заявка на роль учителя, поданная С САЙТА. До неё заявку можно было отправить
// только кнопкой в боте, то есть человеку без Telegram — никак: и заявку не
// подать, и роль ему не выдать, потому что выдача шла по telegram id.
//
// Заявка кладётся в ту же очередь уведомлений — по одному заданию на каждого
// админа. Своей доставки у API нет, а бот очередь и так разбирает.
//
// user_id у задания — ЗАЯВИТЕЛЬ, а не получатель: получатель здесь админ, и его
// в app_users может не быть вовсе. Благодаря этому заявка исчезает вместе с
// удалённым аккаунтом и переезжает при слиянии аккаунтов.
async function requestTeacherRole(userId, adminTelegramIds, { db = pool } = {}) {
  const admins = [...new Set((adminTelegramIds || []).map(String).filter(Boolean))];
  const who = await db.query(
    `SELECT COALESCE(p.display_name, u.display_name, '') AS display_name, COALESCE(u.email, '') AS email,
            COALESCE(p.role, 'student') AS role,
            EXISTS(SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'telegram') AS has_telegram
     FROM app_users u LEFT JOIN social_profiles p ON p.user_id = u.id
     WHERE u.id = $1 AND u.disabled_at IS NULL`, [userId]);
  if (!who.rowCount) return { status: 'unknown' };
  const row = who.rows[0];
  if (row.role === 'teacher' || row.role === 'admin') return { status: 'already', role: row.role };
  if (!admins.length) return { status: 'no_admins' };

  // Повторное нажатие не должно будить всех админов заново.
  const pending = await db.query(
    `SELECT 1 FROM social_notification_jobs
     WHERE kind = 'teacher_request' AND user_id = $1 AND status IN ('pending', 'processing') LIMIT 1`,
    [userId]);
  if (pending.rowCount) return { status: 'pending' };

  const payload = {
    userId: String(userId),
    displayName: row.display_name || '',
    email: row.email || '',
    hasTelegram: row.has_telegram === true,
  };
  // 🔴 Плейсхолдеры, а не значения: было `(${index + 3})`, что давало SQL
  // «VALUES (3)» — литеральное число вместо параметра. Postgres видел в запросе
  // два параметра, получал три и отвечал 08P01, то есть заявка с сайта падала
  // с 500 ВСЕГДА, с первого дня. Тип задаём явно: у VALUES его вывести не из
  // чего, а telegram_id — текст.
  const recipients = admins.map((_, index) => `($${index + 3}::text)`).join(', ');
  const inserted = await db.query(
    // 🔴 Список админов разворачивается в VALUES, а не в unnest: проверка
    // изоляции читает «FROM unnest» как обращение к таблице и падает. Значения
    // всё равно параметризованы, в текст запроса не подставляется ничего.
    `INSERT INTO social_notification_jobs(assignment_id, user_id, telegram_id, kind, payload)
     SELECT NULL, $1, list.admin, 'teacher_request', $2::jsonb
     FROM (VALUES ${recipients}) AS list(admin)
     RETURNING id`,
    [userId, JSON.stringify(payload), ...admins]);
  return { status: 'sent', delivered: inserted.rowCount };
}

async function whoIs(telegramId, { db = pool } = {}) {
  const result = await db.query(
    `SELECT u.id AS user_id, COALESCE(p.display_name, u.display_name, '') AS display_name,
            COALESCE(p.role, 'student') AS role
     FROM user_identities i
     JOIN app_users u ON u.id = i.user_id AND u.disabled_at IS NULL
     LEFT JOIN social_profiles p ON p.user_id = u.id
     WHERE i.provider = 'telegram' AND i.subject = $1`, [String(telegramId)]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { userId: row.user_id, displayName: row.display_name, role: row.role };
}

module.exports = {
  ensureProfile, patchProfile, roleOf, setRole, whoIs, whoIsByEmail, requestTeacherRole,
  enqueueAssignmentNotifications, claimNotifications, ackNotification, failNotification,
  getState, putState,
  saveAttempts, insertEvents, recomputeAssignment, activeAssignmentsFor,
  quotaState, consumeQuota,
  weeklyLeaderboard,
  createClass, listClasses, ownedClass, updateClass, rotateJoinCode, classStudents, joinClass, myClasses,
  createAssignment, listAssignments, ownedAssignment, updateAssignment, cancelAssignment,
  assignmentResults, assignmentStudentDetail, studentAssignments, studentDigest, teacherDigest,
  mergeUserData,
  listCustomTasks, createCustomTask, updateCustomTask, archiveCustomTask,
  assignmentTasksForStudent, assignmentTasksForTeacher,
  randomJoinCode, MOSCOW_TODAY,
};
