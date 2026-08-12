'use strict';

// В рейтинге человека видят посторонние, поэтому полное имя туда уходить не
// должно. Ученики вводят «Фамилия Имя» (плейсхолдер онбординга — «Иванов Иван,
// 11 'А'»), класс иногда дописывают через запятую. Показываем имя и инициал
// фамилии: «Иван И.».
//
// Вынесено из server.js, чтобы предметный рейтинг обществознания не заводил
// вторую, неизбежно расходящуюся копию правил приватности.
function leaderboardName(raw) {
  const cleaned = String(raw == null ? '' : raw).split(',')[0].trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Аноним';
  const parts = cleaned.split(' ').filter(Boolean);
  // Одно слово — это обычно ник («Ученик»), а не фамилия; сокращать нечего.
  if (parts.length < 2) return parts[0].slice(0, 32);
  return `${parts[1].slice(0, 32)} ${parts[0][0].toUpperCase()}.`;
}

module.exports = { leaderboardName };
