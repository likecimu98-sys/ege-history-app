/** @type {import('tailwindcss').Config} */
module.exports = {
  // Сканируем всю разметку и JS-шаблоны, чтобы ни один используемый класс не выпал.
  // (Аудит показал 0 динамически собираемых классов — все классы литеральны, поэтому скан надёжен.)
  content: [
    './index.html',
    './cram.html',
    './*.js',
  ],
  // Тёмная тема управляется классом .dark на <html> (как в текущем output.css).
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};
