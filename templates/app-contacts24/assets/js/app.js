(function (global) {
  'use strict';

  var App = global.App = global.App || {};
  var Api = App.Api;
  var Filter = App.Filter;
  var List = App.List;

  var state = {
    companyId: null,
    portalDomain: null,
    searchText: '',
    filterValues: {},
    items: [],
    userMap: {},
    total: 0,
    nextStart: null,
    hasMore: false,
    selected: new Set(),
    loading: false,
    filterOpen: false,
    boundContactIds: null
  };

  var els = {};

  var TARGET_PLACEMENT = 'CRM_COMPANY_DETAIL_TAB';

  function init() {
    var appEl = document.getElementById('app');

    Api.init().then(function () {
      var placement = Api.getPlacementInfo();
      var placementCode = placement && placement.placement;

      if (placementCode !== TARGET_PLACEMENT) {
        showLanding(placementCode);
        return;
      }

      var companyId = placement.options && (placement.options.ID || placement.options.COMPANY_ID);
      if (!companyId) {
        showLanding(placementCode);
        return;
      }

      appEl.innerHTML = '';
      buildLayout(appEl);
      state.companyId = String(companyId);
      state.portalDomain = Api.getDomain();
      restoreFilter();
      reload();
    }).catch(function (err) {
      showFatal(err.message || 'Не удалось инициализировать приложение.');
    });
  }

  function showFatal(message) {
    var appEl = document.getElementById('app');
    appEl.innerHTML =
      '<div class="banner"><span>' + escapeHtml(message) + '</span></div>';
  }

  function showLanding(placementCode) {
    var appEl = document.getElementById('app');
    appEl.innerHTML = '';

    var box = document.createElement('div');
    box.className = 'empty';

    var icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = '🏢';

    var title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = 'Приложение установлено и работает';

    var textWrap = document.createElement('div');
    textWrap.style.maxWidth = '560px';
    textWrap.style.margin = '0 auto';

    var p1 = document.createElement('div');
    p1.className = 'empty-text';
    p1.textContent = 'Приложение добавляет вкладку «Контакты» в карточку компании CRM. На вкладке — список всех контактов этой компании с поиском, фильтрами и массовыми действиями (отвязать от компании или удалить).';

    var p2 = document.createElement('div');
    p2.className = 'empty-text';
    p2.textContent = 'Чтобы открыть приложение, перейдите в CRM → Компании, откройте любую компанию — вкладка «Контакты» появится сверху карточки рядом со «Сделками» и «Делами».';

    textWrap.appendChild(p1);
    textWrap.appendChild(p2);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = 'Перейти к списку компаний';
    btn.addEventListener('click', function () { Api.openPath('/crm/company/'); });

    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(textWrap);
    box.appendChild(btn);

    appEl.appendChild(box);
  }

  function buildLayout(root) {
    var toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    var createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'btn btn-primary';
    createBtn.textContent = '+ Создать';
    createBtn.addEventListener('click', createContact);

    var filterBtn = document.createElement('button');
    filterBtn.type = 'button';
    filterBtn.className = 'btn btn-ghost';
    filterBtn.textContent = 'Фильтр';
    filterBtn.addEventListener('click', toggleFilter);

    var spacer = document.createElement('div');
    spacer.className = 'spacer';

    var searchForm = document.createElement('form');
    searchForm.className = 'search-form';
    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      state.searchText = searchInput.value.trim();
      reload();
    });

    var searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Поиск по фамилии, телефону или email';
    searchInput.setAttribute('aria-label', 'Поиск контактов');

    var searchBtn = document.createElement('button');
    searchBtn.type = 'submit';
    searchBtn.className = 'btn btn-ghost';
    searchBtn.textContent = 'Найти';

    searchForm.appendChild(searchInput);
    searchForm.appendChild(searchBtn);

    toolbar.appendChild(createBtn);
    toolbar.appendChild(filterBtn);
    toolbar.appendChild(spacer);
    toolbar.appendChild(searchForm);
    root.appendChild(toolbar);

    var filterPanel = document.createElement('div');
    filterPanel.className = 'filter-panel hidden';
    root.appendChild(filterPanel);

    var chips = document.createElement('div');
    chips.className = 'filter-chips';
    root.appendChild(chips);

    var selectionBar = document.createElement('div');
    selectionBar.className = 'selection-bar hidden';
    root.appendChild(selectionBar);

    var listContainer = document.createElement('div');
    listContainer.className = 'list-container';
    root.appendChild(listContainer);

    els = {
      root: root,
      toolbar: toolbar,
      createBtn: createBtn,
      filterBtn: filterBtn,
      searchInput: searchInput,
      filterPanel: filterPanel,
      chips: chips,
      selectionBar: selectionBar,
      listContainer: listContainer
    };
  }

  function toggleFilter() {
    state.filterOpen = !state.filterOpen;
    if (state.filterOpen) {
      Filter.render(els.filterPanel, state.filterValues, {
        apply: function () {
          state.filterValues = Filter.collectValues(els.filterPanel);
          persistFilter();
          renderChips();
          state.filterOpen = false;
          els.filterPanel.classList.add('hidden');
          reload();
        },
        reset: function () {
          state.filterValues = {};
          persistFilter();
          Filter.render(els.filterPanel, {}, this);
          renderChips();
          reload();
        }
      });
      els.filterPanel.classList.remove('hidden');
    } else {
      els.filterPanel.classList.add('hidden');
    }
  }

  function renderChips() {
    Filter.renderChips(els.chips, state.filterValues, function (key) {
      delete state.filterValues[key];
      persistFilter();
      renderChips();
      if (state.filterOpen) {
        Filter.render(els.filterPanel, state.filterValues, {
          apply: function () {
            state.filterValues = Filter.collectValues(els.filterPanel);
            persistFilter(); renderChips();
            state.filterOpen = false; els.filterPanel.classList.add('hidden');
            reload();
          },
          reset: function () {
            state.filterValues = {}; persistFilter();
            Filter.render(els.filterPanel, {}, this); renderChips(); reload();
          }
        });
      }
      reload();
    });
  }

  function reload() {
    state.nextStart = null;
    state.items = [];
    state.selected.clear();
    state.boundContactIds = null;
    updateSelectionBar();
    loadPage(0);
  }

  function loadPage(start) {
    if (state.loading) return;
    state.loading = true;

    if (start === 0) List.renderSkeleton(els.listContainer, 8);

    Api.listContacts({
      companyId: state.companyId,
      boundContactIds: state.boundContactIds,
      searchText: state.searchText,
      filter: state.filterValues,
      start: start
    }).then(function (res) {
      if (res.boundContactIds && !state.boundContactIds) {
        state.boundContactIds = res.boundContactIds;
      }

      var items = res.data || [];
      state.items = (start === 0) ? items : state.items.concat(items);
      state.total = res.total || state.items.length;
      state.nextStart = res.nextStart;
      state.hasMore = !!(res.more && res.nextStart !== null);

      var userIds = state.items.map(function (c) { return c.ASSIGNED_BY_ID; }).filter(Boolean);
      var missing = userIds.filter(function (id) { return !state.userMap[String(id)]; });

      var userPromise = missing.length
        ? Api.getUsers(missing).then(function (map) { Object.assign(state.userMap, map); })
        : Promise.resolve();

      return userPromise.then(function () {
        state.loading = false;
        renderList();
      });
    }).catch(function (err) {
      state.loading = false;
      List.renderError(els.listContainer, err.message || 'Ошибка запроса', function () { reload(); });
    });
  }

  function renderList() {
    if (state.items.length === 0) {
      var hasFilter = !!state.searchText || Object.keys(state.filterValues).length > 0;
      List.renderEmpty(els.listContainer, hasFilter ? 'filter' : 'none', function () {
        if (hasFilter) {
          state.searchText = '';
          state.filterValues = {};
          els.searchInput.value = '';
          persistFilter();
          renderChips();
          reload();
        } else {
          createContact();
        }
      });
      return;
    }

    List.render(els.listContainer, {
      items: state.items,
      userMap: state.userMap,
      selected: state.selected,
      total: state.total,
      hasMore: state.hasMore,
      portalDomain: state.portalDomain,
      callbacks: {
        open: openContact,
        selectOne: function (id, on) {
          if (on) state.selected.add(id); else state.selected.delete(id);
          updateSelectionBar();
          renderList();
        },
        selectAll: function (on, pageIds) {
          pageIds.forEach(function (id) {
            if (on) state.selected.add(id); else state.selected.delete(id);
          });
          updateSelectionBar();
          renderList();
        },
        loadMore: function () {
          if (state.nextStart !== null) loadPage(state.nextStart);
        }
      }
    });
  }

  function updateSelectionBar() {
    var n = state.selected.size;
    if (n === 0) {
      els.selectionBar.classList.add('hidden');
      els.selectionBar.innerHTML = '';
      return;
    }
    els.selectionBar.classList.remove('hidden');
    els.selectionBar.innerHTML = '';

    var count = document.createElement('div');
    count.className = 'count';
    count.textContent = 'Выбрано: ' + n;
    els.selectionBar.appendChild(count);

    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    els.selectionBar.appendChild(spacer);

    var detachBtn = document.createElement('button');
    detachBtn.type = 'button';
    detachBtn.className = 'btn btn-ghost btn-sm';
    detachBtn.textContent = 'Отвязать от компании';
    detachBtn.addEventListener('click', confirmDetach);
    els.selectionBar.appendChild(detachBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', confirmDelete);
    els.selectionBar.appendChild(deleteBtn);

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-link btn-sm';
    clearBtn.textContent = 'Снять выделение';
    clearBtn.addEventListener('click', function () {
      state.selected.clear();
      updateSelectionBar();
      renderList();
    });
    els.selectionBar.appendChild(clearBtn);
  }

  function confirmDetach() {
    var ids = Array.from(state.selected);
    openModal({
      title: 'Отвязать от компании?',
      text: 'Будет отвязано ' + pluralContacts(ids.length) + ' от этой компании. Сами контакты останутся в Битрикс24.',
      confirmText: 'Отвязать',
      confirmClass: 'btn-primary',
      onConfirm: function (modal) { runDetach(ids, modal); }
    });
  }

  function confirmDelete() {
    var ids = Array.from(state.selected);
    openModal({
      title: 'Удалить контакты?',
      text: 'Будет удалено ' + pluralContacts(ids.length) + ' полностью из Битрикс24. Действие необратимо.',
      confirmText: 'Удалить',
      confirmClass: 'btn-danger',
      onConfirm: function (modal) { runDelete(ids, modal); }
    });
  }

  function runDetach(ids, modal) {
    setModalBusy(modal, 'Отвязываем…');
    Api.detachContactsFromCompany(ids, state.companyId, function (done, total) {
      updateModalProgress(modal, done, total, 'Отвязано');
    }).then(function (res) {
      closeModal(modal);
      reportResult(res, 'отвязан', 'отвязано');
      reload();
    }).catch(function (err) {
      closeModal(modal);
      toast(err.message || 'Не удалось отвязать контакты', 'error');
    });
  }

  function runDelete(ids, modal) {
    setModalBusy(modal, 'Удаляем…');
    Api.deleteContacts(ids, function (done, total) {
      updateModalProgress(modal, done, total, 'Удалено');
    }).then(function (res) {
      closeModal(modal);
      reportResult(res, 'удалён', 'удалено');
      reload();
    }).catch(function (err) {
      closeModal(modal);
      toast(err.message || 'Не удалось удалить контакты', 'error');
    });
  }

  function reportResult(res, singular, plural) {
    var ok = res.succeeded.length;
    var fail = res.failed.length;
    if (fail === 0) {
      toast('Успешно ' + plural + ': ' + ok, 'success');
    } else if (ok === 0) {
      toast('Ничего не ' + plural + '. Ошибок: ' + fail, 'error');
      console.warn('Bitrix errors:', res.failed);
    } else {
      toast(plural.charAt(0).toUpperCase() + plural.slice(1) + ': ' + ok + '. Не удалось: ' + fail + '.', 'error');
      console.warn('Bitrix errors:', res.failed);
    }
  }

  function pluralContacts(n) {
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return n + ' контакт';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return n + ' контакта';
    return n + ' контактов';
  }

  function createContact() {
    Api.openPath('/crm/contact/details/0/?company_id=' + encodeURIComponent(state.companyId))
      .then(function () { reload(); });
  }

  function openContact(id) {
    Api.openPath('/crm/contact/details/' + encodeURIComponent(id) + '/')
      .then(function () { reload(); });
  }

  function persistFilter() {
    try {
      var key = 'contactsTabFilter_' + state.companyId;
      var payload = { search: state.searchText, filter: state.filterValues };
      global.sessionStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {}
  }

  function restoreFilter() {
    try {
      var key = 'contactsTabFilter_' + state.companyId;
      var raw = global.sessionStorage.getItem(key);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p.search) { state.searchText = p.search; els.searchInput.value = p.search; }
      if (p.filter) { state.filterValues = p.filter; renderChips(); }
    } catch (e) {}
  }

  // ---------- Modal / toast helpers ----------

  function openModal(cfg) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    var modal = document.createElement('div');
    modal.className = 'modal';

    var h = document.createElement('h3');
    h.textContent = cfg.title;

    var p = document.createElement('p');
    p.textContent = cfg.text;

    var actions = document.createElement('div');
    actions.className = 'modal-actions';

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Отмена';
    cancel.addEventListener('click', function () { closeModal(backdrop); });

    var confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn ' + (cfg.confirmClass || 'btn-primary');
    confirm.textContent = cfg.confirmText || 'Подтвердить';
    confirm.addEventListener('click', function () { cfg.onConfirm(backdrop); });

    actions.appendChild(cancel);
    actions.appendChild(confirm);

    modal.appendChild(h);
    modal.appendChild(p);
    modal.appendChild(actions);

    modal._refs = { title: h, text: p, cancel: cancel, confirm: confirm, actions: actions };
    backdrop._modal = modal;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop && !modal._busy) closeModal(backdrop);
    });

    return backdrop;
  }

  function setModalBusy(backdrop, label) {
    var modal = backdrop._modal;
    modal._busy = true;
    modal._refs.confirm.disabled = true;
    modal._refs.cancel.disabled = true;
    modal._refs.text.textContent = label;
    var bar = document.createElement('div');
    bar.className = 'progress-bar';
    var inner = document.createElement('div');
    bar.appendChild(inner);
    modal.insertBefore(bar, modal._refs.actions);
    modal._refs.progress = inner;
  }

  function updateModalProgress(backdrop, done, total, label) {
    var modal = backdrop._modal;
    if (!modal._refs.progress) return;
    modal._refs.progress.style.width = Math.round((done / total) * 100) + '%';
    modal._refs.text.textContent = label + ' ' + done + ' из ' + total + '…';
  }

  function closeModal(backdrop) {
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  var toastTimer = null;
  function toast(message, kind) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    if (toastTimer) clearTimeout(toastTimer);

    var t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' is-error' : (kind === 'success' ? ' is-success' : ''));
    t.textContent = message;
    document.body.appendChild(t);
    toastTimer = setTimeout(function () { t.remove(); }, 4500);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
