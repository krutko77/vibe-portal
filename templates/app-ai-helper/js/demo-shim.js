// Перехватывает api/* — отдаёт synthetic AI-ответы из window.DEMO_DATA.
// Подключается ДО app.jsx. Реальный app.jsx работает без модификаций.

(() => {
  const D = window.DEMO_DATA;
  if (!D) { console.error('DEMO_DATA not loaded'); return; }

  const ok = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));

  // Имитация задержки AI: 0.8-1.4 сек — чтобы спиннер успевал крутиться,
  // но пользователь не ждал слишком долго.
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const aiDelay = () => 800 + Math.floor(Math.random() * 600);

  const realFetch = window.fetch.bind(window);

  async function handle(url, method, init) {
    // Нормализуем относительный путь app.jsx использует «api/...» без слеша
    const path = url.replace(/^\.?\/?/, '/').replace(/^\/+/, '/');

    if (path === '/api/health') {
      return ok({ ok: true, ai: true, provider: { name: 'demo', model: 'sales-objections-v1' } });
    }

    if (path === '/api/suggest' && method === 'POST') {
      const body = init && init.body ? JSON.parse(init.body) : {};
      const text = body.transcript || '';
      await delay(aiDelay());
      return ok(D.findSuggestion(text));
    }

    if (path === '/api/analyze' && method === 'POST') {
      const body = init && init.body ? JSON.parse(init.body) : {};
      const text = body.transcript || '';
      await delay(1500); // анализ дольше — это нормально
      return ok(D.buildAnalyze(text));
    }

    if (path === '/api/kb/list' && method === 'GET') {
      return ok({ files: D.KB_FILES });
    }

    if (path === '/api/kb/upload' && method === 'POST') {
      const body = init && init.body ? JSON.parse(init.body) : {};
      const entry = {
        id: 'kb-' + (Date.now() % 10000),
        filename: body.filename,
        mimeType: body.mimeType,
        size: Math.round((body.contentBase64 || '').length * 0.75),
        uploadedAt: new Date().toISOString(),
      };
      D.KB_FILES.push(entry);
      await delay(400);
      return ok({ file: entry });
    }

    if (path.startsWith('/api/kb/') && method === 'DELETE') {
      const id = path.split('/').pop();
      const idx = D.KB_FILES.findIndex(f => f.id === id);
      if (idx >= 0) D.KB_FILES.splice(idx, 1);
      return ok({ ok: true });
    }

    console.warn('[demo-shim] unmatched:', method, url);
    return ok({});
  }

  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input.url || '');
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    // app.jsx использует относительные «api/...» — захватываем оба варианта
    if (url.startsWith('api/') || url.startsWith('/api/') || url.startsWith('./api/')) {
      return handle(url, method, init);
    }
    return realFetch(input, init);
  };

  // Полный мок BX24 — в боевом приложении SDK грузится с //api.bitrix24.com,
  // но мы этот тег убрали из index.html. b24-bridge.js видит typeof BX24 ===
  // 'undefined' и не пытается работать с плейсментом.
  // На всякий случай определим минимальный объект — если что-то всё-таки
  // обратится к BX24, не упадёт.
  window.BX24 = {
    init: (cb) => { setTimeout(cb, 0); },
    placement: { info: () => ({ placement: 'DEFAULT', options: {} }) },
    callMethod: (method, params, callback) => {
      setTimeout(() => callback({
        data: () => ({}),
        error: () => null,
        answer: { result: {} },
      }), 50);
    },
    callBatch: (calls, cb) => { setTimeout(() => cb({}), 50); },
    getAuth: () => ({ access_token: 'demo', domain: 'demo.bitrix24.ru' }),
    resizeWindow: () => {},
    fitWindow: () => {},
  };
})();
