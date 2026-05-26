// Перехват /api/portals.php, /api/proxy.php и заголовка X-FieldsMap-Token.
// Имитирует Б24-вызовы локально на синтетике из demo-data.js.
(() => {
  const D = window.DEMO_DATA;
  if (!D) { console.error('DEMO_DATA not loaded'); return; }

  const portals = [...D.PORTALS]; // изменяемая копия
  const ok = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  }));

  // ── Хендлеры конкретных Б24-методов ────────────────────────────────
  function handleBxMethod(method, params) {
    if (method === 'crm.type.list') {
      // Смарт-процессов в демо нет (можно прибавить, но и без них достаточно)
      return { result: { types: [] }, total: 0 };
    }
    if (method === 'crm.item.fields') {
      const eid = Number(params.entityTypeId);
      const fields = D.FIELDS_BY_ENTITY[eid] || {};
      return { result: { fields } };
    }
    if (method === 'crm.category.list') {
      const eid = Number(params.entityTypeId);
      const cats = D.CATEGORIES[eid] || [];
      return { result: { categories: cats } };
    }
    if (method === 'crm.item.details.configuration.get') {
      const eid = Number(params.entityTypeId);
      const catKey = `c${params.extras?.dealCategoryId ?? params.extras?.categoryId ?? 'def'}`;
      const key = `${eid}:${catKey}:${params.scope || 'C'}`;
      const layout = D.savedLayouts[key];
      if (layout) return { result: layout };
      // вернём дефолт для C-scope, для P-scope — пусто
      if ((params.scope || 'C') === 'C') return { result: D.LAYOUTS_BY_ENTITY[eid] || [] };
      return { result: [] };
    }
    if (method === 'crm.item.details.configuration.set') {
      const eid = Number(params.entityTypeId);
      const catKey = `c${params.extras?.dealCategoryId ?? params.extras?.categoryId ?? 'def'}`;
      const key = `${eid}:${catKey}:${params.scope || 'C'}`;
      D.savedLayouts[key] = params.data || params.config || params.layout || params;
      return { result: true };
    }
    if (method === 'crm.item.details.configuration.reset') {
      const eid = Number(params.entityTypeId);
      const catKey = `c${params.extras?.dealCategoryId ?? params.extras?.categoryId ?? 'def'}`;
      delete D.savedLayouts[`${eid}:${catKey}:C`];
      delete D.savedLayouts[`${eid}:${catKey}:P`];
      return { result: true };
    }
    if (method === 'userfieldconfig.add' || method === 'userfieldconfig.update' || method === 'userfieldconfig.delete') {
      // создание / обновление / удаление UF-полей — для демо просто success
      return { result: true };
    }
    if (method === 'batch') {
      const cmd = params.cmd || {};
      const subResult = {};
      for (const [k, v] of Object.entries(cmd)) {
        const [m, qs] = String(v).split('?');
        const subParams = {};
        if (qs) {
          for (const pair of qs.split('&')) {
            const [pk, pv] = pair.split('=');
            if (pk) subParams[decodeURIComponent(pk)] = decodeURIComponent(pv || '');
          }
        }
        const r = handleBxMethod(m, subParams);
        subResult[k] = r.result;
      }
      return { result: { result: subResult, result_error: {}, result_total: {}, result_next: {} } };
    }
    return { result: null };
  }

  // ── /api/portals.php ───────────────────────────────────────────────
  function handlePortals(method, body) {
    if (method === 'GET') return ok({ portals });
    if (method === 'POST') {
      const { name, webhook } = body || {};
      const host = (webhook || '').replace(/^https?:\/\//, '').split('/')[0];
      const portal = {
        id: 'demo-portal-' + (portals.length + 1) + '-' + Date.now().toString(36),
        name, host,
        createdAt: new Date().toISOString(),
      };
      portals.push(portal);
      return ok({ portal });
    }
    if (method === 'DELETE') {
      const idx = portals.findIndex(p => p.id === body?.id);
      if (idx >= 0) portals.splice(idx, 1);
      return ok({ ok: true });
    }
    return ok({});
  }

  // ── /api/proxy.php ─────────────────────────────────────────────────
  function handleProxy(body) {
    const { method, params } = body || {};
    if (!method) return ok({ error: 'no method' }, 400);
    const r = handleBxMethod(method, params || {});
    return ok(r);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input.url || '');
    if (!url.startsWith('api/') && !url.startsWith('/api/') && !/\bapi\/(portals|proxy)\.php/.test(url)) {
      return realFetch(input, init);
    }
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    let body = null;
    if (init.body) {
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; } catch { body = null; }
    }

    if (/portals\.php/.test(url)) return handlePortals(method, body);
    if (/proxy\.php/.test(url))   return handleProxy(body);

    console.warn('[demo-shim] unmatched:', method, url);
    return ok({});
  };
})();
