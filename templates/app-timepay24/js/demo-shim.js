// Перехватывает /api/* — отдаёт synthetic данные из window.DEMO_DATA.
// Подключается ДО app.js. Реальный app.js работает без модификаций.
//
// Также мокает BX24 SDK (приложение раньше грузилось как Битрикс24-плейсмент,
// а bindB24Links() проверяет typeof BX24 — пусть будет undefined, тогда
// клики по data-b24-path пойдут как обычные ссылки в новой вкладке).

(() => {
  const D = window.DEMO_DATA;
  if (!D) { console.error('DEMO_DATA not loaded'); return; }

  const ok = (data) => Promise.resolve(new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  const realFetch = window.fetch.bind(window);

  function handle(url, method) {
    // /api/config
    if (url === '/api/config') return ok(D.config);

    // /api/report/status — баннер прогресса; для демо всегда idle
    if (url === '/api/report/status') return ok(D.status);

    // /api/report?year=YYYY&month=MM
    if (url.startsWith('/api/report?')) {
      const params = new URLSearchParams(url.split('?')[1]);
      const year  = parseInt(params.get('year'), 10);
      const month = parseInt(params.get('month'), 10);
      return ok(D.getMonth(year, month));
    }

    // POST /api/report/refresh*  — для демо просто 202
    if (url.startsWith('/api/report/refresh')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, started: true, demo: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    console.warn('[demo-shim] unmatched:', method, url);
    return ok({});
  }

  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input.url || '');
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    if (url.startsWith('/api/')) return handle(url, method);
    return realFetch(input, init);
  };

  // Минимальный мок BX24 — приложение его проверяет на typeof, не падает
  // если undefined, но пусть будет «как в проде»: openLink → window.open.
  window.BX24 = {
    init: (cb) => { setTimeout(cb, 0); },
    placement: { info: () => ({ placement: 'DEFAULT', options: {} }) },
    callMethod: (method, params, callback) => {
      const result = (window.DEMO_DATA && window.DEMO_DATA.bx24 && window.DEMO_DATA.bx24[method]) || {};
      setTimeout(() => callback({
        data: () => result,
        error: () => null,
        answer: { result },
      }), 50);
    },
    callBatch: (calls, cb) => { setTimeout(() => cb({}), 50); },
    getAuth: () => ({ access_token: 'demo', domain: 'demo.bitrix24.ru' }),
    openLink: (url) => { window.open(url, '_blank', 'noopener'); },
    resizeWindow: () => {},
    fitWindow: () => {},
  };
})();
