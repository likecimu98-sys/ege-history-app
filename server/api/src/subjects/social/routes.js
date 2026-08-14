'use strict';

// Маршруты предмета «обществознание»: /api/v1/subjects/social/...
//
// 🔴 ПРЕДМЕТ ОПРЕДЕЛЯЕТ МАРШРУТ, А НЕ КЛИЕНТ. Ни один обработчик ниже не читает
// поле subject из тела запроса, и добавлять его нельзя: тогда запрос со страницы
// обществознания смог бы адресоваться данным истории. Второй замок — origin:
// социальные маршруты принимают только origin обществознания из серверной
// настройки SOCIAL_ORIGINS.
//
// Общее с историей — ровно аутентификация: та же кука сессии, тот же CSRF, те же
// app_users/user_identities/user_sessions. Всё учебное отдельное (см. store.js).

const { env } = require('../../env');
const schema = require('./schema');
const socialStore = require('./store');

const PREFIX = '/api/v1/subjects/social';

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

// Идентификаторы классов и ДЗ — uuid. Проверяем форму до похода в базу: иначе
// PostgreSQL ответит 22P02 и наружу уйдёт 500 вместо честного 404.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function uuid(value, error = 'not_found') {
  const id = String(value || '');
  if (!UUID_RE.test(id)) throw fail(error, 404);
  return id;
}

// Админ предмета — тот, кто уже назначен админом сервера по Telegram ID. Это
// единственный способ получить первую роль: назначать самого себя учителем через
// пользовательский маршрут нельзя (проверка плана «ученик не может назначить
// себе роль»).
function serverAdmin(session) {
  return (session.user.identities || [])
    .filter(identity => identity.provider === 'telegram')
    .some(identity => env.adminTelegramIds.has(String(identity.subject)));
}

async function effectiveRole(session, store, options = {}) {
  if (serverAdmin(session)) return 'admin';
  return store.roleOf(session.userId, options);
}

function requireTeacher(role) {
  if (role !== 'teacher' && role !== 'admin') throw fail('teacher_required', 403);
}

// Origin — второй замок предметной изоляции. Пустой Origin допускаем по той же
// причине, что и в истории (его не шлют не-CORS запросы и часть WebView), защита
// при этом остаётся на CSRF-токене из куки.
function originIsSocial(req) {
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  if (!origin) return true;
  return env.socialOrigins.includes(origin);
}

async function handleSocial(req, res, url, session, deps) {
  const { json, readJson, requireMutationAuth, limiter, scope } = deps;
  const store = deps.store || socialStore;
  const now = Date.now();

  // Флаг выключен — предмета для сервера не существует. Именно 404, а не 403:
  // выключенная функция не должна подтверждать посторонним, что она есть.
  if (!env.socialApi) throw fail('not_found', 404);
  if (!originIsSocial(req)) throw fail('origin_forbidden', 403);
  if (!session) throw fail('unauthorized', 401);

  const path = url.pathname.slice(PREFIX.length) || '/';
  const method = req.method;
  const userId = session.userId;
  const limits = { freeDaily: env.socialFreeDaily };

  // ---------------------------------------------------------------- ученик --
  if (method === 'GET' && path === '/me/profile') {
    const profile = await store.ensureProfile(userId, { displayName: session.user.displayName }, {});
    const role = await effectiveRole(session, store);
    return json(res, 200, {
      // Общая идентичность — из общего аккаунта, предметная часть — из social_profiles.
      account: {
        uid: session.user.uid,
        displayName: session.user.displayName,
        email: session.user.email,
        isAnonymous: session.user.isAnonymous,
        // Каких способов входа НЕ хватает — знание клиента, а не догадка. По
        // одному isAnonymous «телеграм + гугл» и «только телеграм» неразличимы,
        // и приложение не может предложить привязать второй способ. Ровно
        // из-за этого ученик, занимавшийся в браузере под Google, открывал
        // мини-апп, попадал в пустой аккаунт и не видел ни одной подсказки,
        // как соединить их обратно.
        hasGoogle: (session.user.identities || []).some(item => item.provider === 'google'),
        hasTelegram: (session.user.identities || []).some(item => item.provider === 'telegram'),
      },
      profile: {
        displayName: profile.display_name || '',
        role,
        settings: profile.settings || {},
      },
      serverTime: now,
    });
  }

  // Заявка на роль учителя, поданная С САЙТА. До неё заявка существовала только
  // кнопкой в боте: человек, вошедший через Google и не открывавший бота, не мог
  // ни попросить роль, ни получить её — выдача шла по telegram id.
  if (method === 'POST' && path === '/me/teacher-request') {
    requireMutationAuth(req, session);
    // Гость живёт в одном браузере и исчезает вместе с ним. Классы и домашние
    // задания пережили бы такого учителя, а он их — нет.
    if (session.user.isAnonymous) throw fail('sign_in_required', 403);
    const result = await store.requestTeacherRole(session.userId, [...env.adminTelegramIds], {});
    if (result.status === 'unknown') throw fail('user_not_found', 404);
    return json(res, 200, result);
  }

  if (method === 'PATCH' && path === '/me/profile') {
    requireMutationAuth(req, session);
    const patch = schema.profilePatch(await readJson(req, 16384));
    const profile = await store.patchProfile(userId, patch, {});
    return json(res, 200, {
      profile: { displayName: profile.display_name || '', role: await effectiveRole(session, store), settings: profile.settings || {} },
    });
  }

  if (method === 'GET' && path === '/me/state') {
    return json(res, 200, await store.getState(userId, {}));
  }

  if (method === 'PUT' && path === '/me/state') {
    requireMutationAuth(req, session);
    const body = schema.statePut(await readJson(req, schema.MAX_STATE_BYTES + 4096));
    const result = await store.putState(userId, body.state, body.baseRevision, {});
    // 409 — не ошибка, а нормальная жизнь двух устройств: клиент получает
    // актуальный снимок, сливает по стабильным ID и присылает снова.
    return json(res, result.ok ? 200 : 409, result);
  }

  if (method === 'POST' && path === '/me/attempts') {
    requireMutationAuth(req, session);
    if (!limiter.take(`${scope}:social-attempts`, 120).ok) return json(res, 429, { error: 'rate_limited' });
    const events = schema.attemptBatch(await readJson(req, 262144), { now });
    const result = await store.saveAttempts(userId, events, {});
    return json(res, 200, { ...result, serverTime: now });
  }

  if (method === 'GET' && path === '/me/assignments') {
    return json(res, 200, { assignments: await store.studentAssignments(userId, {}) });
  }

  // Задания варианта, выданного этому ученику. Банк ФИПИ лежит в самом
  // приложении, а свои задания учителя приходят только отсюда и только тому,
  // кому это ДЗ выдано.
  const myTasksMatch = path.match(/^\/me\/assignments\/([^/]+)\/tasks$/);
  if (myTasksMatch && method === 'GET') {
    const assignmentId = uuid(decodeURIComponent(myTasksMatch[1]), 'assignment_not_found');
    return json(res, 200, { tasks: await store.assignmentTasksForStudent(userId, assignmentId, {}) });
  }

  if (method === 'GET' && path === '/me/classes') {
    return json(res, 200, { classes: await store.myClasses(userId, {}) });
  }

  if (method === 'POST' && path === '/me/classes/join') {
    requireMutationAuth(req, session);
    // Перебор кодов — это перебор чужих классов, поэтому лимит жёсткий.
    if (!limiter.take(`${scope}:social-join`, 10, 60 * 60 * 1000).ok) return json(res, 429, { error: 'rate_limited' });
    const body = await readJson(req, 4096);
    const code = schema.joinCode(body.code);
    return json(res, 200, await store.joinClass(userId, code, {}));
  }

  if (method === 'GET' && path === '/quota') {
    return json(res, 200, await store.quotaState(userId, { limits }));
  }

  if (method === 'POST' && path === '/quota/consume') {
    requireMutationAuth(req, session);
    const body = await readJson(req, 4096);
    const amount = Math.min(200, Math.max(1, Math.trunc(Number(body.amount)) || 1));
    const result = await store.consumeQuota(userId, amount, { limits });
    if (!result.ok) return json(res, 429, { error: 'daily_limit_reached', ...result });
    return json(res, 200, result);
  }

  if (method === 'GET' && path === '/leaderboards/weekly') {
    const limit = Number(url.searchParams.get('limit')) || 20;
    const classId = url.searchParams.get('classId');
    // Рейтинг класса виден только тем, кто в этом классе состоит: иначе по
    // идентификатору класса посторонний собирал бы список учеников школы.
    if (classId) {
      const mine = await store.myClasses(userId, {});
      const owned = await store.listClasses(userId, {});
      const allowed = [...mine, ...owned].some(item => String(item.id) === String(classId));
      if (!allowed) throw fail('class_not_found', 404);
    }
    return json(res, 200, await store.weeklyLeaderboard(userId, { limit, classId: classId ? uuid(classId) : null }));
  }

  // --------------------------------------------------------------- учитель --
  if (path.startsWith('/teacher/')) {
    const role = await effectiveRole(session, store);
    requireTeacher(role);

    if (method === 'GET' && path === '/teacher/classes') {
      return json(res, 200, { role, classes: await store.listClasses(userId, {}) });
    }
    if (method === 'POST' && path === '/teacher/classes') {
      requireMutationAuth(req, session);
      const data = schema.classCreate(await readJson(req, 8192));
      const created = await store.createClass(userId, data, {});
      return json(res, 200, { class: { id: created.id, title: created.title, joinCode: created.join_code, status: created.status, students: 0 } });
    }

    const classMatch = path.match(/^\/teacher\/classes\/([^/]+)$/);
    if (classMatch && (method === 'PATCH' || method === 'DELETE')) {
      requireMutationAuth(req, session);
      const classId = uuid(decodeURIComponent(classMatch[1]), 'class_not_found');
      const patch = method === 'DELETE'
        ? { status: 'archived' }
        : schema.classPatch(await readJson(req, 8192));
      const updated = await store.updateClass(userId, classId, patch, {});
      return json(res, 200, { class: { id: updated.id, title: updated.title, joinCode: updated.join_code, status: updated.status } });
    }

    const studentsMatch = path.match(/^\/teacher\/classes\/([^/]+)\/students$/);
    if (studentsMatch && method === 'GET') {
      const classId = uuid(decodeURIComponent(studentsMatch[1]), 'class_not_found');
      return json(res, 200, { students: await store.classStudents(userId, classId, {}) });
    }

    const codeMatch = path.match(/^\/teacher\/classes\/([^/]+)\/join-code$/);
    if (codeMatch && method === 'POST') {
      requireMutationAuth(req, session);
      const classId = uuid(decodeURIComponent(codeMatch[1]), 'class_not_found');
      const rotated = await store.rotateJoinCode(userId, classId, {});
      return json(res, 200, { classId: rotated.id, joinCode: rotated.join_code });
    }

    // ------------------------------------------- свои задания учителя --
    if (method === 'GET' && path === '/teacher/tasks') {
      return json(res, 200, { tasks: await store.listCustomTasks(userId, {}) });
    }
    if (method === 'POST' && path === '/teacher/tasks') {
      requireMutationAuth(req, session);
      const data = schema.customTask(await readJson(req, 32768));
      return json(res, 200, { task: await store.createCustomTask(userId, data, {}) });
    }
    const taskMatch = path.match(/^\/teacher\/tasks\/([^/]+)$/);
    if (taskMatch && (method === 'PUT' || method === 'DELETE')) {
      requireMutationAuth(req, session);
      const taskId = uuid(decodeURIComponent(taskMatch[1]), 'task_not_found');
      if (method === 'DELETE') return json(res, 200, await store.archiveCustomTask(userId, taskId, {}));
      const data = schema.customTask(await readJson(req, 32768));
      return json(res, 200, { task: await store.updateCustomTask(userId, taskId, data, {}) });
    }

    const assignmentTasksMatch = path.match(/^\/teacher\/assignments\/([^/]+)\/tasks$/);
    if (assignmentTasksMatch && method === 'GET') {
      const assignmentId = uuid(decodeURIComponent(assignmentTasksMatch[1]), 'assignment_not_found');
      return json(res, 200, { tasks: await store.assignmentTasksForTeacher(userId, assignmentId, {}) });
    }

    if (method === 'GET' && path === '/teacher/assignments') {
      const classId = url.searchParams.get('classId');
      return json(res, 200, {
        assignments: await store.listAssignments(userId, { classId: classId ? uuid(classId, 'class_not_found') : null }),
      });
    }
    if (method === 'POST' && path === '/teacher/assignments') {
      requireMutationAuth(req, session);
      const data = schema.assignmentCreate(await readJson(req, 16384), { now });
      uuid(data.classId, 'class_not_found');
      const assignment = await store.createAssignment(userId, data, {});
      // Рассылка ставится в очередь ЗДЕСЬ и одним запросом на весь класс.
      // Провал рассылки не должен отменять уже выданное задание: учитель нажал
      // «выдать» — задание есть, а недоставленное уведомление повторится само.
      let notified = 0;
      try {
        notified = await store.enqueueAssignmentNotifications(assignment, {});
      } catch (error) {
        notified = -1;
      }
      return json(res, 200, { assignment, notified });
    }

    const assignmentMatch = path.match(/^\/teacher\/assignments\/([^/]+)$/);
    if (assignmentMatch) {
      const assignmentId = uuid(decodeURIComponent(assignmentMatch[1]), 'assignment_not_found');
      if (method === 'GET') {
        const row = await store.ownedAssignment(userId, assignmentId, {});
        return json(res, 200, { assignment: { id: row.id, classId: row.class_id, title: row.title, types: row.types, blocks: row.blocks, topics: row.topics, questionGoal: Number(row.question_goal), includeImages: Boolean(row.include_images), dueAt: row.due_at ? new Date(row.due_at).getTime() : null, status: row.status, issuedAt: new Date(row.issued_at).getTime() } });
      }
      if (method === 'PATCH') {
        requireMutationAuth(req, session);
        const patch = schema.assignmentPatch(await readJson(req, 8192), { now });
        return json(res, 200, { assignment: await store.updateAssignment(userId, assignmentId, patch, {}) });
      }
      if (method === 'DELETE') {
        requireMutationAuth(req, session);
        return json(res, 200, await store.cancelAssignment(userId, assignmentId, {}));
      }
    }

    const resultsMatch = path.match(/^\/teacher\/assignments\/([^/]+)\/results$/);
    if (resultsMatch && method === 'GET') {
      const assignmentId = uuid(decodeURIComponent(resultsMatch[1]), 'assignment_not_found');
      return json(res, 200, await store.assignmentResults(userId, assignmentId, {}));
    }

    // Разбор домашки по одному ученику. Отдельный маршрут, а не поле в общем
    // ответе: класс может быть большой, и таскать все попытки всех учеников в
    // таблицу результатов незачем.
    const detailMatch = path.match(/^\/teacher\/assignments\/([^/]+)\/results\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const assignmentId = uuid(decodeURIComponent(detailMatch[1]), 'assignment_not_found');
      const studentId = uuid(decodeURIComponent(detailMatch[2]), 'student_not_found');
      return json(res, 200, await store.assignmentStudentDetail(userId, assignmentId, studentId, {}));
    }

    // Назначение роли. Только админ предмета, и только явным маршрутом —
    // учитель не может расплодить учителей, ученик не может стать учителем.
    if (method === 'POST' && path === '/teacher/roles') {
      requireMutationAuth(req, session);
      if (role !== 'admin') throw fail('admin_required', 403);
      const body = await readJson(req, 4096);
      const targetUserId = uuid(body.userId, 'user_not_found');
      const updated = await store.setRole(targetUserId, String(body.role || 'teacher'), {});
      return json(res, 200, { userId: updated.user_id, role: updated.role });
    }
  }

  throw fail('not_found', 404);
}

module.exports = { handleSocial, PREFIX, serverAdmin, effectiveRole, originIsSocial, uuid };
