// Перехват /api/* для демо. Реальный app.js работает без модификаций.
(() => {
  const D = window.DEMO_DATA;
  if (!D) { console.error('DEMO_DATA not loaded'); return; }

  const ok = (data) => Promise.resolve(new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));

  // Игнорируем фильтры (период/менеджер/тип) — для демо отдаём один и тот же набор.
  const overview = () => ok({
    sheetName: D.sheetName,
    totalAll: D.totalAll,
    managers: D.managers,
    types: D.types,
    dateRange: D.dateRange,
    weeksList: D.weeksList,
    criteriaNames: D.criteria,
    criteriaError: null,
    summary: D.summary,
  });

  const dashboard = () => ok({
    weeks: D.weeks,
    managers: D.managers,
    types: D.types,
    criteria: D.criteria,
    byWeekManager: D.byWeekManager,
    byWeekType: D.byWeekType,
    byWeekCriterion: D.byWeekCriterion,
    byWeekTotal: D.byWeekTotal,
    summary: D.summary,
  });

  const hubCall = () => ok({
    window: '08:50–10:10',
    total: D.hubTotal,
    byManager: D.hubByManager,
  });

  const secretary = () => ok({
    total: D.secCalls.length,
    criteriaNames: D.criteria,
    byManager: D.secByManager,
    byObjection: D.secByObjection,
    calls: D.secCalls,
  });

  const refresh = () => ok({ ok: true });
  const me = () => ok({ user: 'demo' });
  const logout = () => ok({ ok: true });

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input.url || '');
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();

    if (url.startsWith('/api/') || url.startsWith('/auth/') || url.startsWith('/login')) {
      if (url.startsWith('/api/overview'))    return overview();
      if (url.startsWith('/api/dashboard'))   return dashboard();
      if (url.startsWith('/api/hub-call'))    return hubCall();
      if (url.startsWith('/api/secretary'))   return secretary();
      if (url.startsWith('/api/refresh'))     return refresh();
      if (url.startsWith('/api/auth/logout')) return logout();
      console.warn('[demo-shim] unmatched:', method, url);
      return ok({});
    }
    return realFetch(input, init);
  };
})();
