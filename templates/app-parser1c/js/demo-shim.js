// В parser1c нет реальных fetch/BX24 — приложение полностью клиентское.
// demo-shim здесь нужен только чтобы перехватить случайный fetch (если будет
// добавлен) и обеспечить заглушку BX24 для openPath после импорта.

(function () {
  var realFetch = window.fetch && window.fetch.bind(window);
  if (realFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.startsWith('/api/') || url.startsWith('/auth/')) {
        console.warn('[demo-shim] swallowed fetch:', url);
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  }

  window.BX24 = window.BX24 || {
    init: function (cb) { setTimeout(cb, 0); },
    callMethod: function (m, p, cb) { setTimeout(function () { cb && cb({ data: function () { return {}; }, error: function () { return null; }, answer: { result: {} } }); }, 30); },
    callBatch: function (calls, cb) { setTimeout(function () { cb && cb({}); }, 30); },
    placement: { info: function () { return { placement: 'DEFAULT', options: {} }; } },
    getAuth: function () { return { access_token: 'demo', domain: 'demo.bitrix24.ru' }; },
    getDomain: function () { return 'demo.bitrix24.ru'; },
    openPath: function (path, cb) { setTimeout(function () { cb && cb({ result: 'close' }); }, 0); },
    resizeWindow: function () {}, fitWindow: function () {},
  };
})();
