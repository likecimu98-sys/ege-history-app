(function () {
  'use strict';
  const THEME_KEY = 'ege_social_theme_v1';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    const dark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (_) {
    document.documentElement.dataset.theme = 'light';
  }

  let delayedShown = false;
  const startedAt = Date.now();
  function watchBoot() {
    const screen = document.getElementById('bootScreen');
    if (window.__EGE_SOCIAL_READY__) {
      if (screen) screen.classList.add('boot-screen--done');
      window.setTimeout(function () {
        if (screen) screen.hidden = true;
      }, 240);
      return;
    }
    if (!delayedShown && Date.now() - startedAt >= 12000) {
      const delayed = document.getElementById('bootDelayed');
      if (delayed) delayed.hidden = false;
      delayedShown = true;
    }
    window.setTimeout(watchBoot, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchBoot, { once: true });
  else watchBoot();
})();
