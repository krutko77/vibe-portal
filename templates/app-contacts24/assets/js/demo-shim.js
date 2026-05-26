// Mock BX24 SDK для демо.
// Подключается ДО api.js / app.js. Эмулирует асинхронность и форму ответа.

(function () {
  var D = window.DEMO_DATA;
  if (!D) { console.error('[demo-shim] DEMO_DATA not loaded'); return; }

  // Параметры размещения — приложение ждёт CRM_COMPANY_DETAIL_TAB с COMPANY_ID
  window.__BX24_PARAMS = {
    PLACEMENT: 'CRM_COMPANY_DETAIL_TAB',
    PLACEMENT_OPTIONS: JSON.stringify({ ID: D.companyId, COMPANY_ID: D.companyId }),
  };

  // Состояние «базы» — изменяется delete/update вызовами
  var DB = {
    contacts: D.contacts.slice(),
    boundIds: D.boundContactIds.slice(),
  };

  // ───────────────────────────────────────────────────────────────────────
  // Резолверы методов CRM
  // ───────────────────────────────────────────────────────────────────────

  function fieldMatch(contact, field, value) {
    var v = (contact[field] || '').toString().toLowerCase();
    return v.indexOf(String(value).toLowerCase()) !== -1;
  }

  function applyContactFilter(items, filter) {
    if (!filter) return items;
    return items.filter(function (c) {
      // ID
      if (Array.isArray(filter.ID) && filter.ID.indexOf(c.ID) === -1) return false;
      if (typeof filter.ID === 'string' && filter.ID !== c.ID) return false;
      // ASSIGNED
      if (filter.ASSIGNED_BY_ID && String(c.ASSIGNED_BY_ID) !== String(filter.ASSIGNED_BY_ID)) return false;
      // Wildcards %FIELD
      var keys = Object.keys(filter);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.charAt(0) === '%') {
          var f = k.slice(1);
          var v = filter[k];
          if (f === 'PHONE' || f === 'EMAIL') {
            var arr = c[f] || [];
            var ok = false;
            for (var j = 0; j < arr.length; j++) {
              if (String(arr[j].VALUE || '').toLowerCase().indexOf(String(v).toLowerCase()) !== -1) { ok = true; break; }
            }
            if (!ok) return false;
          } else if (!fieldMatch(c, f, v)) return false;
        }
        if (k === '>=DATE_CREATE') {
          if (c.DATE_CREATE < filter[k]) return false;
        }
        if (k === '<=DATE_CREATE') {
          if (c.DATE_CREATE > filter[k]) return false;
        }
      }
      return true;
    });
  }

  function sortContacts(items, order) {
    if (!order) return items;
    var keys = Object.keys(order);
    return items.slice().sort(function (a, b) {
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var dir = (String(order[k]).toUpperCase() === 'DESC') ? -1 : 1;
        var va = (a[k] || '').toString().toLowerCase();
        var vb = (b[k] || '').toString().toLowerCase();
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
      }
      return 0;
    });
  }

  var METHODS = {
    'crm.company.contact.items.get': function (params) {
      var ids = (params && params.id) ? DB.boundIds : [];
      return {
        result: ids.map(function (id) { return { CONTACT_ID: Number(id), SORT: 100 }; }),
        total: ids.length,
      };
    },
    'crm.contact.list': function (params) {
      var f = (params && params.filter) || {};
      var items = applyContactFilter(DB.contacts, f);
      items = sortContacts(items, params && params.order);
      var start = (params && params.start) || 0;
      var page = items.slice(start, start + 50);
      return {
        result: page,
        total: items.length,
        next: (start + 50 < items.length) ? (start + 50) : null,
      };
    },
    'crm.contact.get': function (params) {
      var id = String(params && params.ID);
      var c = DB.contacts.filter(function (x) { return x.ID === id; })[0];
      return { result: c || null };
    },
    'crm.contact.delete': function (params) {
      var id = String(params && params.ID);
      var before = DB.contacts.length;
      DB.contacts = DB.contacts.filter(function (c) { return c.ID !== id; });
      DB.boundIds = DB.boundIds.filter(function (b) { return b !== id; });
      return { result: DB.contacts.length < before };
    },
    'crm.contact.update': function (params) {
      var id = String(params && params.ID);
      var fields = (params && params.fields) || {};
      var c = DB.contacts.filter(function (x) { return x.ID === id; })[0];
      if (c) {
        if (fields.COMPANY_IDS) c.COMPANY_IDS = fields.COMPANY_IDS;
        if ('COMPANY_ID' in fields) c.COMPANY_ID = String(fields.COMPANY_ID);
        // если компания удалена из списка — отвязать
        if (Array.isArray(c.COMPANY_IDS) && c.COMPANY_IDS.indexOf(D.companyId) === -1) {
          DB.boundIds = DB.boundIds.filter(function (b) { return b !== id; });
        }
      }
      return { result: true };
    },
    'user.get': function (params) {
      if (params && params.ID) {
        var u = D.users.filter(function (x) { return String(x.ID) === String(params.ID); })[0];
        return { result: u ? [u] : [] };
      }
      // ACTIVE list, ignoring start (наш список < 50)
      return { result: D.users.slice(), total: D.users.length, next: null };
    },
  };

  function exec(method, params) {
    var fn = METHODS[method];
    if (!fn) {
      console.warn('[demo-shim] unmocked method:', method);
      return { result: [], total: 0, next: null };
    }
    return fn(params || {});
  }

  // ───────────────────────────────────────────────────────────────────────
  // Объект BX24 — повторяет то, что использует api.js
  // ───────────────────────────────────────────────────────────────────────

  function makeAnswerWrap(resp) {
    var data = resp.result;
    var total = resp.total;
    var next = resp.next;
    return {
      data: function () { return data; },
      error: function () { return null; },
      total: function () { return typeof total === 'number' ? total : (Array.isArray(data) ? data.length : 0); },
      more: function () { return next !== null && next !== undefined; },
      answer: { result: data, next: next, total: total },
    };
  }

  window.BX24 = {
    init: function (cb) { setTimeout(function () { cb && cb(); }, 0); },
    placement: {
      info: function () {
        return {
          placement: 'CRM_COMPANY_DETAIL_TAB',
          options: { ID: D.companyId, COMPANY_ID: D.companyId },
        };
      },
    },
    callMethod: function (method, params, callback) {
      var resp = exec(method, params);
      setTimeout(function () { callback && callback(makeAnswerWrap(resp)); }, 30);
    },
    callBatch: function (calls, cb /* , halt */) {
      var out = {};
      Object.keys(calls || {}).forEach(function (key) {
        var c = calls[key];
        var method = Array.isArray(c) ? c[0] : c.method;
        var params = Array.isArray(c) ? c[1] : c.params;
        out[key] = makeAnswerWrap(exec(method, params));
      });
      setTimeout(function () { cb && cb(out); }, 50);
    },
    getAuth: function () {
      return { access_token: 'demo', domain: D.domain, member_id: 'demo', expires_in: 3600 };
    },
    getDomain: function () { return D.domain; },
    openPath: function (path, cb) {
      // в демо — не открываем реальную ссылку, просто всплашка
      try { showToast('В реальном Битрикс24 открылся бы путь: ' + path); } catch (e) {}
      setTimeout(function () { cb && cb({ result: 'close' }); }, 0);
    },
    resizeWindow: function () {},
    fitWindow: function () {},
    scrollParentWindow: function () {},
  };

  function showToast(text) {
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 18px;border-radius:6px;font-size:13px;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:80%;text-align:center;';
    document.body.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; }, 2200);
    setTimeout(function () { t.remove(); }, 2700);
  }
})();
