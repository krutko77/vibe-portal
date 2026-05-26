// Перехватывает fetch'и к /api/* и /auth/* — отдаёт synthetic данные из window.DEMO_DATA.
// Подключается в index.html ДО app.js. Реальный app.js работает без модификаций.

(() => {
  const D = window.DEMO_DATA;
  if (!D) { console.error('DEMO_DATA not loaded'); return; }

  const ok = (data) => Promise.resolve(new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  const ROUTES = {
    'GET /api/tasks':    () => ok({ tasks: D.tasks, statuses: D.statuses, lastSyncedAt: D.lastSyncedAt }),
    'GET /api/chat':     () => ok({ messages: D.chat }),
    'POST /api/refresh': () => ok({ tasks: D.tasks, lastSyncedAt: new Date().toISOString() }),
    'GET /api/lurv':     () => ok(D.lurv),
    'GET /auth/me':      () => ok(D.user),
    'POST /auth/logout': () => ok({ ok: true }),
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input.url || '');
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();

    // только локальные пути
    if (url.startsWith('/api/') || url.startsWith('/auth/')) {
      const handler = ROUTES[`${method} ${url}`];
      if (handler) return handler();
      // неизвестный API-эндпоинт — пустой 200
      console.warn('[demo-shim] unmatched:', method, url);
      return ok({});
    }
    return realFetch(input, init);
  };

  // app.js делает window.location.href = '/login.html' при 401 — у нас 401 не возникает,
  // так что страница просто грузится с данными.
})();
