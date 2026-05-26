(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var List = App.List = {};

  List.renderSkeleton = function (container, rows) {
    rows = rows || 8;
    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'skeleton';
    for (var i = 0; i < rows; i++) {
      var row = document.createElement('div');
      row.className = 'skeleton-row';
      for (var j = 0; j < 6; j++) row.appendChild(document.createElement('div'));
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  };

  List.renderError = function (container, message, onRetry) {
    container.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'error-state';
    var title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = 'Не удалось загрузить контакты';
    var text = document.createElement('div');
    text.className = 'empty-text';
    text.textContent = message || 'Неизвестная ошибка';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = 'Повторить';
    retry.addEventListener('click', function () { onRetry && onRetry(); });
    box.appendChild(title); box.appendChild(text); box.appendChild(retry);
    container.appendChild(box);
  };

  List.renderEmpty = function (container, mode, onAction) {
    container.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'empty';

    var icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = mode === 'filter' ? '🔍' : '👥';
    box.appendChild(icon);

    var title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = mode === 'filter'
      ? 'По вашему фильтру ничего не найдено'
      : 'В этой компании пока нет контактов';
    box.appendChild(title);

    var text = document.createElement('div');
    text.className = 'empty-text';
    text.textContent = mode === 'filter'
      ? 'Попробуйте изменить или сбросить фильтр.'
      : 'Добавьте первый контакт, чтобы начать.';
    box.appendChild(text);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = mode === 'filter' ? 'Сбросить фильтр' : 'Создать контакт';
    btn.addEventListener('click', function () { onAction && onAction(); });
    box.appendChild(btn);

    container.appendChild(box);
  };

  List.render = function (container, params) {
    var items = params.items;
    var userMap = params.userMap || {};
    var selected = params.selected;
    var total = params.total;
    var hasMore = params.hasMore;
    var callbacks = params.callbacks;
    var portalDomain = params.portalDomain || null;

    container.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';

    var table = document.createElement('table');
    table.className = 'contacts';

    var thead = document.createElement('thead');
    thead.innerHTML =
      '<tr>' +
        '<th class="col-check"><input type="checkbox" id="check-all" aria-label="Выделить все"></th>' +
        '<th class="col-name">ФИО</th>' +
        '<th class="col-post">Должность</th>' +
        '<th class="col-contacts">Телефоны / Email</th>' +
        '<th class="col-assigned">Ответственный</th>' +
        '<th class="col-date">Создан</th>' +
      '</tr>';
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    items.forEach(function (c) { tbody.appendChild(renderRow(c, userMap, selected, callbacks, portalDomain)); });
    table.appendChild(tbody);

    wrap.appendChild(table);
    container.appendChild(wrap);

    var checkAll = thead.querySelector('#check-all');
    var allSelected = items.length > 0 && items.every(function (c) { return selected.has(String(c.ID)); });
    checkAll.checked = allSelected;
    checkAll.indeterminate = !allSelected && items.some(function (c) { return selected.has(String(c.ID)); });
    checkAll.addEventListener('change', function () {
      callbacks.selectAll(checkAll.checked, items.map(function (c) { return String(c.ID); }));
    });

    var footer = document.createElement('div');
    footer.className = 'pagination';
    var count = document.createElement('div');
    var shown = items.length;
    count.textContent = 'Показано ' + shown + ' из ' + (total || shown);
    footer.appendChild(count);

    if (hasMore) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-ghost btn-sm';
      more.textContent = 'Показать ещё ' + Math.min(App.Api.PAGE_SIZE, (total - shown)) + ' →';
      more.addEventListener('click', function () { callbacks.loadMore(); });
      footer.appendChild(more);
    }
    container.appendChild(footer);
  };

  function renderRow(c, userMap, selected, callbacks, portalDomain) {
    var tr = document.createElement('tr');
    var idStr = String(c.ID);
    if (selected.has(idStr)) tr.classList.add('is-selected');

    var tdCheck = document.createElement('td');
    tdCheck.className = 'col-check';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(idStr);
    cb.setAttribute('aria-label', 'Выбрать контакт');
    cb.addEventListener('change', function (e) { e.stopPropagation(); callbacks.selectOne(idStr, cb.checked); });
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    var tdName = document.createElement('td');
    tdName.className = 'col-name';
    var link = document.createElement('a');
    link.href = portalDomain
      ? 'https://' + portalDomain + '/crm/contact/details/' + encodeURIComponent(idStr) + '/'
      : '#';
    link.textContent = formatFullName(c);
    link.addEventListener('click', function (e) {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      callbacks.open(idStr);
    });
    tdName.appendChild(link);
    tr.appendChild(tdName);

    var tdPost = document.createElement('td');
    tdPost.className = 'col-post';
    tdPost.textContent = c.POST || '';
    tr.appendChild(tdPost);

    var tdComm = document.createElement('td');
    tdComm.className = 'col-contacts';
    tdComm.appendChild(renderCommunication(c.PHONE, 'phone'));
    tdComm.appendChild(renderCommunication(c.EMAIL, 'email'));
    tr.appendChild(tdComm);

    var tdAssigned = document.createElement('td');
    tdAssigned.className = 'col-assigned';
    tdAssigned.appendChild(renderAssignee(c.ASSIGNED_BY_ID, userMap));
    tr.appendChild(tdAssigned);

    var tdDate = document.createElement('td');
    tdDate.className = 'col-date';
    tdDate.textContent = formatDateCell(c.DATE_CREATE);
    tr.appendChild(tdDate);

    return tr;
  }

  function formatFullName(c) {
    var full = [c.LAST_NAME, c.NAME, c.SECOND_NAME].filter(Boolean).join(' ').trim();
    return full || ('Контакт #' + c.ID);
  }

  function renderCommunication(arr, kind) {
    var wrap = document.createElement('div');
    wrap.className = 'multi-line';
    if (!Array.isArray(arr) || arr.length === 0) return wrap;
    arr.slice(0, 2).forEach(function (item) {
      if (!item || !item.VALUE) return;
      var a = document.createElement('a');
      if (kind === 'phone') {
        a.href = 'tel:' + item.VALUE.replace(/\s+/g, '');
      } else {
        a.href = 'mailto:' + item.VALUE;
      }
      a.textContent = item.VALUE;
      a.addEventListener('click', function (e) { e.stopPropagation(); });
      wrap.appendChild(a);
    });
    if (arr.length > 2) {
      var more = document.createElement('span');
      more.className = 'muted';
      more.textContent = '+' + (arr.length - 2) + ' ещё';
      wrap.appendChild(more);
    }
    return wrap;
  }

  function renderAssignee(userId, userMap) {
    var span = document.createElement('span');
    span.className = 'assignee';
    if (!userId) { span.textContent = '—'; return span; }
    var user = userMap[String(userId)];
    var av = document.createElement('span');
    av.className = 'avatar';
    if (user && user.PERSONAL_PHOTO) av.style.backgroundImage = 'url("' + user.PERSONAL_PHOTO + '")';
    span.appendChild(av);
    var name = document.createElement('span');
    name.textContent = user ? App.Filter.formatUserName(user) : 'ID ' + userId;
    span.appendChild(name);
    return span;
  }

  function formatDateCell(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    return dd + '.' + mm + '.' + yyyy;
  }

  List.formatFullName = formatFullName;

})(window);
