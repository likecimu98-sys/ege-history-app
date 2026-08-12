'use strict';

// Единственный источник «какой сейчас день и какая неделя» для ВСЕГО сервера.
//
// 🔴 Только Москва, НЕ часы процесса. VPS живёт в Etc/UTC, ученики — в MSK:
// с 00:00 до 03:00 понедельника по Москве сервер считал бы, что ещё воскресенье,
// продолжал отдавать прошлонедельный топ, а всякий открывший приложение ученик
// писал себе новую неделю и из этого топа исчезал. Ровно это уже ломалось в
// истории. Москва круглый год UTC+3, перевода часов нет с 2014-го.
//
// Функция была объявлена внутри server.js, и обществознанию её пришлось бы
// копировать — а копия неизбежно разъезжается с оригиналом молча. Один модуль на
// оба предмета: план этапа 2 требует «считать неделю по Москве одной общей
// серверной функцией».

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

// Выражение для SQL. Дата дня в запросах считается той же Москвой, что и в JS,
// иначе счётчик квоты и события разъедутся на три часа в сутки.
const MOSCOW_TODAY_SQL = "(now() AT TIME ZONE 'Europe/Moscow')::date";

function pad(value) {
  return String(value).padStart(2, '0');
}

function moscowParts(now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  return new Date(at.getTime() + MSK_OFFSET_MS);
}

// Понедельник текущей недели по Москве в формате YYYY-MM-DD.
function mondayStr(now = new Date()) {
  const msk = moscowParts(now);
  const day = msk.getUTCDay() || 7;
  const monday = new Date(msk.getTime() - (day - 1) * 86400000);
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

// Календарный день по Москве в формате YYYY-MM-DD. Совпадает с moscowDayKey в
// клиентском core.js обществознания — по этой строке сходятся дневная активность
// в браузере и дневная квота на сервере.
function moscowDayStr(now = new Date()) {
  const msk = moscowParts(now);
  return `${msk.getUTCFullYear()}-${pad(msk.getUTCMonth() + 1)}-${pad(msk.getUTCDate())}`;
}

module.exports = { mondayStr, moscowDayStr, MSK_OFFSET_MS, MOSCOW_TODAY_SQL };
