// Перехват /api/* для демо «Штаб руководителя».
(() => {
  const D = window.DEMO_DATA;
  if (!D) { console.error('DEMO_DATA not loaded'); return; }

  const ok = (data) => Promise.resolve(new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));

  const tabAnalysts = (tab) => tab === '2' ? D.TAB2_ANALYSTS : D.TAB1_ANALYSTS;

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input.url || '');
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();

    if (!url.startsWith('/api/')) return realFetch(input, init);

    // Разбираем query
    const u = new URL(url, 'http://x');
    const path = u.pathname;
    const tab = u.searchParams.get('tab') || '1';
    const month = u.searchParams.get('month') || '2026-04';

    if (method !== 'GET') {
      // Сохранения замечаний/благодарностей/табеля — no-op для демо
      return ok({ ok: true });
    }

    if (path === '/api/load')      return ok(D.buildLoad(tabAnalysts(tab)));
    if (path === '/api/projects')  return ok(D.buildKanban(tabAnalysts(tab)));
    if (path === '/api/money')     return ok(D.buildMoney(tabAnalysts(tab)));
    if (path === '/api/acts')      return ok(D.buildActs(tabAnalysts(tab)));
    if (path === '/api/stats')     return ok(D.buildStats(tabAnalysts(tab)));
    if (path === '/api/monthly')   return ok(D.buildMonthly(tabAnalysts(tab)));
    if (path === '/api/hours')     return ok(D.buildHours());
    if (path === '/api/dialogs')   return ok(D.buildDialogs());
    if (path === '/api/timesheet') return ok(D.buildTimesheet(month));
    if (path === '/api/fouls')     return ok(D.buildFouls());
    if (path === '/api/thanks')    return ok(D.buildThanks(month));

    console.warn('[demo-shim] unmatched:', method, path);
    return ok({});
  };
})();
