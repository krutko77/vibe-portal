(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var Api = App.Api = {};

  var BATCH_CHUNK = 50;

  Api.PAGE_SIZE = 50;

  Api.init = function () {
    return new Promise(function (resolve, reject) {
      if (typeof BX24 === 'undefined') {
        reject(new Error('BX24 SDK не загружен. Откройте приложение из Битрикс24.'));
        return;
      }
      try {
        BX24.init(function () { resolve(); });
      } catch (e) {
        reject(e);
      }
    });
  };

  Api.getPlacementInfo = function () {
    try { return BX24.placement.info(); }
    catch (e) { return null; }
  };

  Api.getAuth = function () {
    try { return BX24.getAuth(); }
    catch (e) { return null; }
  };

  Api.getDomain = function () {
    try { return BX24.getDomain(); }
    catch (e) { return null; }
  };

  Api.openPath = function (path) {
    return new Promise(function (resolve) {
      try {
        BX24.openPath(path, function (res) { resolve(res); });
      } catch (e) { resolve(null); }
    });
  };

  function extractError(result) {
    var err = result && result.error && result.error();
    if (!err) return 'Неизвестная ошибка';
    if (err.ex && err.ex.error_description) return err.ex.error_description;
    if (err.ex && err.ex.error) return err.ex.error;
    if (err.error_description) return err.error_description;
    return String(err);
  }

  function callMethod(method, params) {
    return new Promise(function (resolve, reject) {
      BX24.callMethod(method, params || {}, function (result) {
        if (result.error()) {
          reject(new Error(extractError(result)));
          return;
        }
        resolve({
          data: result.data(),
          total: result.total(),
          more: result.more(),
          nextStart: (result.answer && typeof result.answer.next !== 'undefined') ? result.answer.next : null
        });
      });
    });
  }

  function callBatch(calls) {
    return new Promise(function (resolve) {
      BX24.callBatch(calls, function (results) { resolve(results); }, false);
    });
  }

  Api.callMethod = callMethod;
  Api.callBatch = callBatch;

  // ---------- Contacts ----------

  Api.getCompanyContactIds = function (companyId) {
    return callMethod('crm.company.contact.items.get', { id: companyId })
      .then(function (res) {
        var items = res.data || [];
        return items.map(function (b) { return String(b.CONTACT_ID); });
      });
  };

  Api.listContacts = function (opts) {
    var idsPromise = opts.boundContactIds
      ? Promise.resolve(opts.boundContactIds)
      : Api.getCompanyContactIds(opts.companyId);

    return idsPromise.then(function (ids) {
      if (!ids.length) {
        return { data: [], total: 0, more: false, nextStart: null, boundContactIds: ids };
      }
      var filter = buildContactFilter(ids, opts.searchText, opts.filter);
      return callMethod('crm.contact.list', {
        filter: filter,
        select: [
          'ID', 'NAME', 'LAST_NAME', 'SECOND_NAME',
          'POST', 'PHONE', 'EMAIL',
          'ASSIGNED_BY_ID', 'DATE_CREATE',
          'COMPANY_IDS', 'COMPANY_ID', 'PHOTO'
        ],
        order: { LAST_NAME: 'ASC', NAME: 'ASC' },
        start: opts.start || 0
      }).then(function (res) {
        res.boundContactIds = ids;
        return res;
      });
    });
  };

  function buildContactFilter(contactIds, searchText, filter) {
    var f = { ID: contactIds };

    if (filter) {
      var wildcardFields = ['NAME', 'LAST_NAME', 'POST', 'PHONE', 'EMAIL'];
      wildcardFields.forEach(function (k) {
        var v = filter[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          f['%' + k] = String(v).trim();
        }
      });
      if (filter.ASSIGNED_BY_ID) {
        f.ASSIGNED_BY_ID = filter.ASSIGNED_BY_ID;
      }
      if (filter.DATE_CREATE_FROM) {
        f['>=DATE_CREATE'] = filter.DATE_CREATE_FROM + 'T00:00:00';
      }
      if (filter.DATE_CREATE_TO) {
        f['<=DATE_CREATE'] = filter.DATE_CREATE_TO + 'T23:59:59';
      }
    }

    if (searchText && String(searchText).trim()) {
      var s = String(searchText).trim();
      if (s.indexOf('@') !== -1) {
        f['%EMAIL'] = s;
      } else if (/^[\d +()\-]+$/.test(s)) {
        f['%PHONE'] = s.replace(/[^\d+]/g, '');
      } else {
        f['%LAST_NAME'] = s;
      }
    }

    return f;
  }

  Api.getContactsByIds = function (ids) {
    if (!ids.length) return Promise.resolve([]);
    var calls = {};
    ids.forEach(function (id) {
      calls['c' + id] = ['crm.contact.get', { ID: id }];
    });
    return callBatch(calls).then(function (results) {
      var out = [];
      ids.forEach(function (id) {
        var r = results['c' + id];
        if (r && !r.error()) out.push(r.data());
      });
      return out;
    });
  };

  Api.deleteContacts = function (ids, onProgress) {
    return processInBatches(ids, function (chunk) {
      var calls = {};
      chunk.forEach(function (id) { calls['c' + id] = ['crm.contact.delete', { ID: id }]; });
      return callBatch(calls).then(function (results) {
        var succeeded = [];
        var failed = [];
        chunk.forEach(function (id) {
          var r = results['c' + id];
          if (r && !r.error()) succeeded.push(id);
          else failed.push({ id: id, error: r ? extractError(r) : 'Нет ответа' });
        });
        return { succeeded: succeeded, failed: failed };
      });
    }, onProgress);
  };

  Api.detachContactsFromCompany = function (ids, companyId, onProgress) {
    return Api.getContactsByIds(ids).then(function (contacts) {
      var byId = {};
      contacts.forEach(function (c) { byId[c.ID] = c; });

      return processInBatches(ids, function (chunk) {
        var calls = {};
        chunk.forEach(function (id) {
          var c = byId[id];
          if (!c) {
            calls['u' + id] = ['crm.contact.get', { ID: id }];
            return;
          }
          var current = Array.isArray(c.COMPANY_IDS) ? c.COMPANY_IDS : [];
          var remaining = current.filter(function (cid) { return String(cid) !== String(companyId); });
          calls['u' + id] = ['crm.contact.update', {
            ID: id,
            fields: {
              COMPANY_ID: remaining[0] || 0,
              COMPANY_IDS: remaining
            }
          }];
        });
        return callBatch(calls).then(function (results) {
          var succeeded = [];
          var failed = [];
          chunk.forEach(function (id) {
            var r = results['u' + id];
            if (r && !r.error()) succeeded.push(id);
            else failed.push({ id: id, error: r ? extractError(r) : 'Нет ответа' });
          });
          return { succeeded: succeeded, failed: failed };
        });
      }, onProgress);
    });
  };

  function processInBatches(items, handler, onProgress) {
    var chunks = [];
    for (var i = 0; i < items.length; i += BATCH_CHUNK) {
      chunks.push(items.slice(i, i + BATCH_CHUNK));
    }
    var totalSucceeded = [];
    var totalFailed = [];
    var processed = 0;

    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        return handler(chunk).then(function (res) {
          totalSucceeded = totalSucceeded.concat(res.succeeded);
          totalFailed = totalFailed.concat(res.failed);
          processed += chunk.length;
          if (onProgress) onProgress(processed, items.length);
        });
      });
    }, Promise.resolve()).then(function () {
      return { succeeded: totalSucceeded, failed: totalFailed };
    });
  }

  // ---------- Users (for "Ответственный" filter and column) ----------

  Api.getUsers = function (ids) {
    var unique = Array.from(new Set(ids.filter(Boolean).map(String)));
    if (!unique.length) return Promise.resolve({});
    var calls = {};
    unique.forEach(function (id) { calls['u' + id] = ['user.get', { ID: id }]; });
    return callBatch(calls).then(function (results) {
      var map = {};
      unique.forEach(function (id) {
        var r = results['u' + id];
        if (r && !r.error()) {
          var arr = r.data();
          if (Array.isArray(arr) && arr[0]) map[arr[0].ID] = arr[0];
        }
      });
      return map;
    });
  };

  Api.getActiveUsers = function () {
    return new Promise(function (resolve, reject) {
      var all = [];
      function load(start) {
        BX24.callMethod('user.get', { ACTIVE: true, start: start || 0 }, function (r) {
          if (r.error()) {
            reject(new Error(extractError(r)));
            return;
          }
          all = all.concat(r.data());
          if (r.more()) { load(r.answer.next); }
          else { resolve(all); }
        });
      }
      load(0);
    });
  };

})(window);
