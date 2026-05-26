(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var Filter = App.Filter = {};

  var FIELDS = [
    { key: 'LAST_NAME', label: 'Фамилия', type: 'text' },
    { key: 'NAME',      label: 'Имя',     type: 'text' },
    { key: 'POST',      label: 'Должность', type: 'text' },
    { key: 'PHONE',     label: 'Телефон', type: 'text' },
    { key: 'EMAIL',     label: 'Email',   type: 'text' },
    { key: 'ASSIGNED_BY_ID', label: 'Ответственный', type: 'user' },
    { key: 'DATE_CREATE', label: 'Создан', type: 'date-range' }
  ];

  Filter.FIELDS = FIELDS;

  var usersCache = null;

  Filter.render = function (container, values, callbacks) {
    values = values || {};
    container.className = 'filter-panel';

    var grid = document.createElement('div');
    grid.className = 'filter-grid';

    FIELDS.forEach(function (f) {
      var field = document.createElement('div');
      field.className = 'field';

      var label = document.createElement('label');
      label.textContent = f.label;
      label.htmlFor = 'flt_' + f.key;
      field.appendChild(label);

      if (f.type === 'text') {
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'flt_' + f.key;
        input.name = f.key;
        input.value = values[f.key] || '';
        input.autocomplete = 'off';
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); callbacks.apply(); }
        });
        field.appendChild(input);
      } else if (f.type === 'user') {
        var sel = document.createElement('select');
        sel.id = 'flt_' + f.key;
        sel.name = f.key;
        var opt0 = document.createElement('option');
        opt0.value = ''; opt0.textContent = '— не выбрано —';
        sel.appendChild(opt0);
        sel.dataset.pending = '1';
        var pending = document.createElement('option');
        pending.disabled = true; pending.textContent = 'Загрузка…';
        sel.appendChild(pending);
        field.appendChild(sel);
        loadUsers().then(function (users) {
          sel.innerHTML = '';
          var empty = document.createElement('option');
          empty.value = ''; empty.textContent = '— не выбрано —';
          sel.appendChild(empty);
          users.forEach(function (u) {
            var o = document.createElement('option');
            o.value = u.ID;
            o.textContent = formatUserName(u);
            sel.appendChild(o);
          });
          if (values[f.key]) sel.value = values[f.key];
          delete sel.dataset.pending;
        }).catch(function () {
          sel.innerHTML = '';
          var fail = document.createElement('option');
          fail.value = ''; fail.textContent = 'Не удалось загрузить пользователей';
          sel.appendChild(fail);
        });
      } else if (f.type === 'date-range') {
        var row = document.createElement('div');
        row.className = 'field-row';

        var from = document.createElement('input');
        from.type = 'date'; from.id = 'flt_' + f.key + '_from';
        from.name = f.key + '_FROM';
        from.value = values[f.key + '_FROM'] || '';
        from.placeholder = 'с';

        var to = document.createElement('input');
        to.type = 'date'; to.id = 'flt_' + f.key + '_to';
        to.name = f.key + '_TO';
        to.value = values[f.key + '_TO'] || '';
        to.placeholder = 'по';

        row.appendChild(from); row.appendChild(to);
        field.appendChild(row);
      }

      grid.appendChild(field);
    });

    container.innerHTML = '';
    container.appendChild(grid);

    var actions = document.createElement('div');
    actions.className = 'filter-actions';

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn btn-primary';
    applyBtn.textContent = 'Применить';
    applyBtn.addEventListener('click', function () { callbacks.apply(); });

    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn-ghost';
    resetBtn.textContent = 'Сбросить';
    resetBtn.addEventListener('click', function () { callbacks.reset(); });

    actions.appendChild(resetBtn);
    actions.appendChild(applyBtn);
    container.appendChild(actions);
  };

  Filter.collectValues = function (container) {
    var out = {};
    var inputs = container.querySelectorAll('input[name], select[name]');
    inputs.forEach(function (el) {
      if (el.dataset && el.dataset.pending) return;
      var v = (el.value || '').trim();
      if (v !== '') out[el.name] = v;
    });
    return out;
  };

  Filter.renderChips = function (container, values, onRemove) {
    container.innerHTML = '';
    var labels = {
      LAST_NAME: 'Фамилия',
      NAME: 'Имя',
      POST: 'Должность',
      PHONE: 'Телефон',
      EMAIL: 'Email',
      ASSIGNED_BY_ID: 'Ответственный',
      DATE_CREATE_FROM: 'Создан с',
      DATE_CREATE_TO: 'Создан по'
    };

    Object.keys(values).forEach(function (key) {
      if (!values[key]) return;
      var chip = document.createElement('span');
      chip.className = 'chip';
      var display = values[key];
      if (key === 'ASSIGNED_BY_ID' && usersCache) {
        var u = usersCache.find(function (x) { return String(x.ID) === String(values[key]); });
        if (u) display = formatUserName(u);
      } else if (key === 'DATE_CREATE_FROM' || key === 'DATE_CREATE_TO') {
        display = formatDate(values[key]);
      }
      chip.textContent = (labels[key] || key) + ': ' + display + ' ';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Убрать фильтр');
      btn.textContent = '×';
      btn.addEventListener('click', function () { onRemove(key); });
      chip.appendChild(btn);
      container.appendChild(chip);
    });
  };

  function loadUsers() {
    if (usersCache) return Promise.resolve(usersCache);
    return App.Api.getActiveUsers().then(function (users) {
      users.sort(function (a, b) {
        return formatUserName(a).localeCompare(formatUserName(b), 'ru');
      });
      usersCache = users;
      return users;
    });
  }

  function formatUserName(u) {
    return [u.LAST_NAME, u.NAME].filter(Boolean).join(' ') || u.EMAIL || ('ID ' + u.ID);
  }

  function formatDate(iso) {
    if (!iso) return '';
    var parts = iso.split('-');
    if (parts.length === 3) return parts[2] + '.' + parts[1] + '.' + parts[0];
    return iso;
  }

  Filter.formatUserName = formatUserName;
  Filter.formatDate = formatDate;
  Filter._usersCache = function () { return usersCache; };

})(window);
