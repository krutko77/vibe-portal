/* FieldsMap — редактор раскладки карточки CRM-сущности удалённого портала.
 *
 * Архитектура:
 *  - Список порталов хранит наш сервер; вебхуки шифрованы, на фронт не уходят.
 *  - Все вызовы Б24 — через api/proxy.php { portalId, method, params }.
 *  - Авторизация: window.SESSION_TOKEN (минтится на iframe-POST от Б24, только админам)
 *    отправляется в заголовке X-FieldsMap-Token к api/*.
 *  - Пагинация: первая страница обычным вызовом, остальные — одним батчем
 *    (Б24 batch до 50 sub-call на запрос).
 */

'use strict';

const STANDARD_ENTITIES = [
  { entityTypeId: 1,  title: 'Лид' },
  { entityTypeId: 2,  title: 'Сделка' },
  { entityTypeId: 3,  title: 'Контакт' },
  { entityTypeId: 4,  title: 'Компания' },
  { entityTypeId: 7,  title: 'Предложение' },
  { entityTypeId: 31, title: 'Счёт' },
];
const STANDARD_ENTITY_IDS = new Set(STANDARD_ENTITIES.map(e => e.entityTypeId));

const SCOPE = 'C';

const state = {
  portals: [],              // [{ id, name, host, createdAt }]
  portal: null,             // current selected portal
  entities: [],
  current: null,
  extras: {},
  categories: [],
  categoryId: null,
  fields: {},
  layout: [],
  layoutSource: null,
  loaded: false,
  dirty: false,
  fieldOverrides: {},
  collapseSections: false,
  userfieldCache: {},
};

// ---------- HTTP / proxy / batch ----------
async function authFetch(path, opts = {}) {
  if (!window.SESSION_TOKEN) {
    showAuthRequired();
    throw new Error('нет сессии — открой приложение из Б24');
  }
  const headers = { 'X-FieldsMap-Token': window.SESSION_TOKEN, ...(opts.headers || {}) };
  if (opts.body && typeof opts.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, { ...opts, headers });
  if (r.status === 401) { showAuthRequired(); throw new Error('сессия истекла — перезагрузи приложение из Б24'); }
  return r;
}

function showAuthRequired() {
  setStatus('Открой приложение из меню Б24 — на админском аккаунте. Прямой URL не работает.', 'err');
}

function bxRaw(method, params = {}) {
  if (!state.portal) return Promise.reject(new Error('Не выбран портал'));
  return authFetch('api/proxy.php', {
    method: 'POST',
    body: { portalId: state.portal.id, method, params },
  }).then(r => r.json());
}

async function bxCall(method, params = {}) {
  const data = await bxRaw(method, params);
  if (data.error) {
    const msg = data.error_description || (typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    throw new Error(method + ': ' + msg);
  }
  return data.result;
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.types)) return payload.types;
    if (Array.isArray(payload.categories)) return payload.categories;
    if (Array.isArray(payload.fields)) return payload.fields;
    if (Array.isArray(payload.users)) return payload.users;
  }
  return payload != null ? [payload] : [];
}

/** Собрать все страницы метода. Первая — обычным вызовом, остальные — одним batch. */
async function bxListAll(method, params = {}) {
  const first = await bxRaw(method, { ...params, start: 0 });
  if (first.error) throw new Error(method + ': ' + (first.error_description || first.error));
  const items = extractItems(first.result);
  const total = Number(first.total ?? items.length);
  if (typeof first.next !== 'number' || items.length >= total) return items;

  const calls = [];
  for (let start = first.next; start < total; start += 50) {
    calls.push({ method, params: { ...params, start } });
  }
  const subResults = await bxBatch(calls);
  for (const sub of subResults) items.push(...extractItems(sub));
  return items;
}

/** batch до 50 sub-call на запрос; принимает [{method, params}], возвращает [result0, result1, ...]. */
async function bxBatch(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 50) {
    const chunk = calls.slice(i, i + 50);
    const cmd = {};
    chunk.forEach((c, idx) => {
      const qs = c.params && Object.keys(c.params).length ? '?' + buildQuery(c.params) : '';
      cmd[`r${idx}`] = c.method + qs;
    });
    const data = await bxRaw('batch', { halt: 0, cmd });
    if (data.error) throw new Error('batch: ' + (data.error_description || JSON.stringify(data.error)));
    const result = data.result || {};
    chunk.forEach((c, idx) => {
      const errs = result.result_error || {};
      if (errs[`r${idx}`]) {
        const e = errs[`r${idx}`];
        throw new Error('batch[' + c.method + ']: ' + (e.error_description || e.error || JSON.stringify(e)));
      }
      out.push((result.result || {})[`r${idx}`]);
    });
  }
  return out;
}

function buildQuery(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((it, i) => {
        if (it !== null && typeof it === 'object') parts.push(buildQuery(it, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(it))}`);
      });
    } else if (typeof v === 'object') {
      parts.push(buildQuery(v, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

// ---------- Portals API ----------
async function loadPortals() {
  const r = await authFetch('api/portals.php');
  const d = await r.json();
  state.portals = Array.isArray(d.portals) ? d.portals : [];
  return state.portals;
}

async function createPortal(name, webhook) {
  const r = await authFetch('api/portals.php', { method: 'POST', body: { name, webhook } });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || 'ошибка ' + r.status);
  return d.portal;
}

async function deletePortal(id) {
  const r = await authFetch('api/portals.php', { method: 'DELETE', body: { id } });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || 'ошибка ' + r.status);
  return true;
}

// ---------- UI helpers ----------
const $ = (sel) => document.querySelector(sel);

function setStatus(msg, kind = 'info') {
  const el = $('#status');
  if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.className = 'status ' + kind;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (kind === 'ok') setTimeout(() => { if (el.textContent === msg) setStatus(null); }, 3000);
}

function markDirty() {
  state.dirty = true;
  $('#btn-save').disabled = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function confirmIfDirty() {
  return !state.dirty || confirm('Несохранённые изменения пропадут. Продолжить?');
}

// ---------- Custom dropdown ----------
function Dropdown(rootEl, { options, value, onChange, searchable = false, placeholder = 'выбрать…' }) {
  let currentValue = value ?? null;
  let openState = false;

  rootEl.innerHTML = `
    <button type="button" class="dd__btn">
      <span class="dd__btn-label"></span>
      <span class="dd__btn-icon">▾</span>
    </button>
    <div class="dd__menu" role="listbox"></div>
  `;
  const btn   = rootEl.querySelector('.dd__btn');
  const label = rootEl.querySelector('.dd__btn-label');
  const menu  = rootEl.querySelector('.dd__menu');

  function setOptions(newOptions) {
    options = newOptions;
    if (!options.find(o => 'value' in o && o.value === currentValue)) currentValue = null;
    render();
  }
  function setValue(v, fire = false) {
    currentValue = v;
    render();
    if (fire) onChange?.(v);
  }
  function setPlaceholder(p) { placeholder = p; render(); }

  function render(filter = '') {
    const flat = options.flatMap(opt => opt.group ? [{ __group: opt.group }, ...opt.items] : [opt]);
    const filtered = filter
      ? flat.filter(o => o.__group || (((o.searchText || o.label) + '').toLowerCase().includes(filter.toLowerCase())))
      : flat;

    const cur = flat.find(o => !o.__group && o.value === currentValue);
    const fullLabel = cur ? cur.label : placeholder;
    label.textContent = truncate(fullLabel, 22);
    btn.title = fullLabel;

    let html = '';
    if (searchable) {
      html += `<div class="dd__search"><input type="text" placeholder="поиск…" autocomplete="off" /></div>`;
    }
    if (filtered.filter(o => !o.__group).length === 0) {
      html += `<div class="dd__opt-empty">ничего не найдено</div>`;
    } else {
      for (const o of filtered) {
        if (o.__group) {
          html += `<div class="dd__group">${escapeHtml(o.__group)}</div>`;
        } else {
          const sel = o.value === currentValue ? 'true' : 'false';
          const hint = o.hint ? `<small class="dd__opt-hint">${escapeHtml(o.hint)}</small>` : '';
          const action = o.action ? `<button class="dd__opt-action" data-action="${escapeHtml(o.action)}" data-value="${escapeHtml(String(o.value))}" title="${escapeHtml(o.actionTitle || '')}">${escapeHtml(o.actionLabel || '✕')}</button>` : '';
          html += `<div class="dd__opt" role="option" data-value="${escapeHtml(String(o.value))}" aria-selected="${sel}">
            <span class="dd__opt-icon">${o.icon || ''}</span>
            <span class="dd__opt-label">${escapeHtml(o.label)} ${hint}</span>
            ${action}
          </div>`;
        }
      }
    }
    menu.innerHTML = html;

    if (searchable) {
      const input = menu.querySelector('.dd__search input');
      input.value = filter;
      input.addEventListener('input', (e) => render(e.target.value));
      input.addEventListener('click', (e) => e.stopPropagation());
      if (openState) setTimeout(() => input.focus(), 0);
    }

    menu.querySelectorAll('.dd__opt-action').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        const v = parseValue(el.dataset.value);
        rootEl.dispatchEvent(new CustomEvent('action', { detail: { action, value: v } }));
      });
    });

    menu.querySelectorAll('.dd__opt').forEach(el => {
      el.addEventListener('click', () => {
        currentValue = parseValue(el.dataset.value);
        close();
        onChange?.(currentValue);
      });
    });
  }

  function parseValue(s) {
    const flat = options.flatMap(opt => opt.group ? opt.items : [opt]);
    const found = flat.find(o => String(o.value) === s);
    return found ? found.value : s;
  }

  function open() {
    if (openState) return;
    closeAllDropdowns();
    openState = true;
    rootEl.setAttribute('aria-expanded', 'true');
    render();
  }
  function close() {
    if (!openState) return;
    openState = false;
    rootEl.setAttribute('aria-expanded', 'false');
    render();
  }
  function toggle() { openState ? close() : open(); }

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

  rootEl.__dd = { setOptions, setValue, setPlaceholder, close, get value() { return currentValue; } };
  render();
  return rootEl.__dd;
}

function closeAllDropdowns() {
  document.querySelectorAll('.dd[aria-expanded="true"]').forEach(el => el.__dd?.close());
}
document.addEventListener('click', () => closeAllDropdowns());

// ---------- Тема ----------
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  localStorage.setItem('fieldsmap-theme', theme);
  updateThemeIcon();
}
function currentTheme() { return localStorage.getItem('fieldsmap-theme') || 'auto'; }
function updateThemeIcon() {
  const t = currentTheme();
  const btn = $('#btn-theme');
  if (!btn) return;
  btn.textContent = t === 'dark' ? '☾' : t === 'light' ? '☀' : '◐';
  btn.title = `Тема: ${t === 'auto' ? 'системная' : t === 'dark' ? 'тёмная' : 'светлая'} (клик — переключить)`;
}
function toggleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(currentTheme()) + 1) % order.length];
  applyTheme(next);
}

// ---------- Portal selection ----------
function rebuildPortalDropdown() {
  const items = state.portals.map(p => ({
    value: p.id,
    label: p.name,
    icon: '🌐',
    hint: p.host,
    searchText: p.name + ' ' + (p.host || ''),
    action: 'delete',
    actionLabel: '✕',
    actionTitle: 'Удалить портал',
  }));
  $('#dd-portal').__dd.setOptions(items.length ? items : [{ value: '__none__', label: '(пусто) — добавь портал', icon: '·' }]);
  $('#dd-portal').__dd.setValue(state.portal?.id || null);
  $('#dd-portal').__dd.setPlaceholder(state.portals.length ? 'выбрать портал…' : 'нет порталов');
  toggleEmptyScreen();
}

function toggleEmptyScreen() {
  const empty = state.portals.length === 0;
  $('#empty-no-portal').classList.toggle('hidden', !empty);
  $('#view-editor').classList.toggle('hidden', empty);
  document.querySelectorAll('.editor-actions').forEach(el => el.classList.toggle('hidden', empty));
}

async function selectPortal(id) {
  const p = state.portals.find(x => x.id === id);
  if (!p) return;
  if (!confirmIfDirty()) { $('#dd-portal').__dd.setValue(state.portal?.id || null); return; }
  state.portal = p;
  state.entities = [];
  state.current = null;
  state.fields = {};
  state.layout = [];
  state.fieldOverrides = {};
  state.userfieldCache = {};
  state.dirty = false;
  $('#btn-save').disabled = true;
  localStorage.setItem('fieldsmap-portal', id);
  $('#dd-entity').__dd.setValue(null);
  $('#dd-category').__dd.setValue(null);
  $('#lbl-category').classList.add('hidden');
  $('#dd-category').classList.add('hidden');
  $('#pool').innerHTML = '<div class="empty">загрузка…</div>';
  $('#sections').innerHTML = '<div class="empty">загрузка…</div>';
  setStatus(`Портал: ${p.name} — загрузка сущностей…`, 'info');
  try {
    await loadEntities();
    if (state.entities.length > 0) {
      state.current = state.entities[0];
      $('#dd-entity').__dd.setValue(state.current.entityTypeId);
      await loadEntityData(state.current.entityTypeId);
    }
  } catch (e) {
    setStatus('Ошибка: ' + e.message, 'err');
  }
}

async function handleDeletePortal(id) {
  const p = state.portals.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Удалить портал «${p.name}» из списка?\nВебхук будет забыт безвозвратно.`)) return;
  try {
    await deletePortal(id);
    state.portals = state.portals.filter(x => x.id !== id);
    if (state.portal?.id === id) {
      state.portal = null;
      localStorage.removeItem('fieldsmap-portal');
      state.entities = [];
      state.current = null;
      $('#dd-entity').__dd.setOptions([]);
      $('#pool').innerHTML = '';
      $('#sections').innerHTML = '';
    }
    rebuildPortalDropdown();
    setStatus('Портал удалён', 'ok');
  } catch (e) {
    setStatus('Не удалось удалить: ' + e.message, 'err');
  }
}

// ---------- Portal modal ----------
function openPortalModal() {
  $('#portal-name').value = '';
  $('#portal-webhook').value = '';
  $('#portal-status').classList.add('hidden');
  $('#modal-new-portal').classList.remove('hidden');
  $('#modal-new-portal').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#portal-name').focus(), 0);
}

function closePortalModal() {
  $('#modal-new-portal').classList.add('hidden');
  $('#modal-new-portal').setAttribute('aria-hidden', 'true');
}

function setPortalStatus(msg, kind = 'info') {
  const el = $('#portal-status');
  if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.className = 'status ' + kind;
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function savePortal() {
  const name    = ($('#portal-name').value    || '').trim();
  const webhook = ($('#portal-webhook').value || '').trim();
  if (!name)    { setPortalStatus('Укажи название.', 'err'); return; }
  if (!/^https:\/\/[^/]+\/rest\/\d+\/[A-Za-z0-9]+\/?$/.test(webhook)) {
    setPortalStatus('Вебхук должен иметь вид https://<портал>/rest/<userId>/<token>/', 'err');
    return;
  }
  setPortalStatus('Сохраняю…', 'info');
  $('#btn-portal-save').disabled = true;
  try {
    const portal = await createPortal(name, webhook);
    state.portals.push(portal);
    rebuildPortalDropdown();
    closePortalModal();
    setStatus(`Портал «${portal.name}» добавлен — выбираю…`, 'ok');
    $('#dd-portal').__dd.setValue(portal.id);
    await selectPortal(portal.id);
  } catch (e) {
    setPortalStatus('Ошибка: ' + e.message, 'err');
  } finally {
    $('#btn-portal-save').disabled = false;
  }
}

// ---------- Загрузка сущностей ----------
async function loadEntities() {
  let spas = [];
  try {
    const types = await bxListAll('crm.type.list');
    spas = types
      .filter(t => t && t.entityTypeId && !STANDARD_ENTITY_IDS.has(Number(t.entityTypeId)))
      .map(t => ({ entityTypeId: Number(t.entityTypeId), title: t.title || ('SPA #' + t.id), isSpa: true }));
  } catch (e) {
    console.warn('crm.type.list недоступен:', e);
    setStatus('Смарт-процессы не загрузились (нет права crm на вебхуке?). Стандартные сущности — работают.', 'info');
  }

  state.entities = [
    ...STANDARD_ENTITIES.map(e => ({ ...e, isSpa: false })),
    ...spas.sort((a, b) => a.title.localeCompare(b.title)),
  ];

  const ddOptions = [{
    group: 'Стандартные',
    items: STANDARD_ENTITIES.map(e => ({ value: e.entityTypeId, label: e.title, icon: '◆' })),
  }];
  if (spas.length > 0) {
    ddOptions.push({
      group: 'Смарт-процессы',
      items: spas.map(s => ({ value: s.entityTypeId, label: s.title, icon: '⚙' })),
    });
  }
  $('#dd-entity').__dd.setOptions(ddOptions);
}

// ---------- Поля и раскладка ----------
async function loadEntityCategories(entityTypeId) {
  const catKey = categoryKeyFor(entityTypeId);
  const lbl = $('#lbl-category');
  const dd  = $('#dd-category');

  if (!catKey) {
    state.categories = [];
    state.categoryId = null;
    state.extras = {};
    lbl.classList.add('hidden');
    dd.classList.add('hidden');
    return;
  }

  const cats = await fetchCategories(entityTypeId);
  state.categories = cats;

  if (cats.length === 0) {
    state.categoryId = null;
    state.extras = {};
    lbl.classList.add('hidden');
    dd.classList.add('hidden');
    return;
  }

  const lsKey = 'fieldsmap-cat-' + entityTypeId;
  const remembered = Number(localStorage.getItem(lsKey)) || null;
  state.categoryId = (remembered && cats.find(c => c.id === remembered)) ? remembered : cats[0].id;
  state.extras = { [catKey]: state.categoryId };

  dd.__dd.setOptions(cats.map(c => ({ value: c.id, label: c.name, icon: '▸' })));
  dd.__dd.setValue(state.categoryId);
  lbl.classList.remove('hidden');
  dd.classList.remove('hidden');
}

async function reloadLayoutOnly() {
  if (!state.current) return;
  state.loaded = false;
  state.dirty = false;
  $('#btn-save').disabled = true;
  setStatus('Загрузка раскладки…', 'info');
  try {
    const fieldsRes = await bxCall('crm.item.fields', { entityTypeId: state.current.entityTypeId });
    const fields = fieldsRes?.fields || fieldsRes || {};
    const { layout, source, via } = await fetchLayoutWithFallback(state.current.entityTypeId, fields, state.extras);
    state.fields = enrichFieldsWithLayoutEntries(fields, layout);
    state.layout = normalizeLayout(layout, state.fields);
    state.fieldOverrides = indexOverridesFromLayout(state.layout);
    state.layoutSource = source;
    state.loaded = true;
    renderAll();
    const catNote = state.categoryId
      ? ` (воронка «${state.categories.find(c => c.id === state.categoryId)?.name || state.categoryId}»)`
      : '';
    if (source === 'built-from-fields') {
      setStatus('В Б24 раскладка не сохранена' + catNote + ' — собрал стартовую из всех полей. Перетаскивай и нажми «Сохранить».', 'info');
    } else if (source === 'empty') {
      setStatus('Не удалось получить ни раскладку, ни поля.', 'err');
    } else {
      setStatus('Раскладка загружена' + catNote + ': ' + (via || source), 'ok');
    }
  } catch (e) {
    setStatus('Ошибка загрузки: ' + e.message, 'err');
  }
}

async function loadEntityData(entityTypeId) {
  state.loaded = false;
  state.dirty = false;
  $('#btn-save').disabled = true;
  setStatus('Загрузка полей и раскладки…', 'info');

  $('#pool').innerHTML = '<div class="empty">загрузка…</div>';
  $('#sections').innerHTML = '<div class="empty">загрузка…</div>';

  try {
    await loadEntityCategories(entityTypeId);

    const fieldsRes = await bxCall('crm.item.fields', { entityTypeId });
    const fields = fieldsRes?.fields || fieldsRes || {};
    console.log('[FieldsMap] crm.item.fields →', Object.keys(fields).length, 'полей');

    const { layout, source, via } = await fetchLayoutWithFallback(entityTypeId, fields, state.extras);

    state.fields = enrichFieldsWithLayoutEntries(fields, layout);
    state.layout = normalizeLayout(layout, state.fields);
    state.fieldOverrides = indexOverridesFromLayout(state.layout);
    state.userfieldCache = {};
    state.layoutSource = source;
    state.loaded = true;
    renderAll();

    const catNote = state.categoryId
      ? ` (воронка «${state.categories.find(c => c.id === state.categoryId)?.name || state.categoryId}»)`
      : '';

    if (source === 'built-from-fields') {
      setStatus('В Б24 раскладка не сохранена' + catNote + ' — собрал стартовую из всех полей сущности. Перетаскивай и нажми «Сохранить».', 'info');
    } else if (source === 'empty') {
      setStatus('Не удалось получить ни раскладку, ни поля. Проверь права (scope crm) на вебхуке и консоль.', 'err');
    } else {
      setStatus('Раскладка загружена' + catNote + ': ' + (via || source), 'ok');
    }
  } catch (e) {
    console.error(e);
    setStatus('Ошибка загрузки: ' + e.message, 'err');
    $('#pool').innerHTML = '<div class="empty">не удалось загрузить</div>';
    $('#sections').innerHTML = '<div class="empty">не удалось загрузить</div>';
  }
}

async function fetchLayoutWithFallback(entityTypeId, fields, extras) {
  const base = { entityTypeId };
  if (extras && Object.keys(extras).length > 0) base.extras = extras;
  const attempts = [{ ...base, scope: 'C' }, { ...base, scope: 'P' }];
  for (const params of attempts) {
    const arr = await tryGetLayout('crm.item.details.configuration.get', params);
    if (arr.length > 0) {
      console.log('[FieldsMap] раскладка получена:', params, '→', arr.length, 'секций');
      return { layout: arr, source: params.scope === 'C' ? 'common' : 'personal', via: JSON.stringify(params) };
    }
  }
  const built = buildDefaultLayout(fields);
  if (built.length > 0) return { layout: built, source: 'built-from-fields', via: 'crm.item.fields' };
  return { layout: [], source: 'empty', via: null };
}

async function fetchCategories(entityTypeId) {
  try {
    const res = await bxCall('crm.category.list', { entityTypeId });
    const arr = Array.isArray(res?.categories) ? res.categories : (Array.isArray(res) ? res : []);
    return arr.map(c => ({ id: Number(c.id), name: c.name || `воронка #${c.id}` }));
  } catch (e) {
    console.warn('[FieldsMap] crm.category.list:', e.message);
    return [];
  }
}

function categoryKeyFor(entityTypeId) {
  if (entityTypeId === 2) return 'dealCategoryId';
  if (entityTypeId === 1 || entityTypeId === 3 || entityTypeId === 4 || entityTypeId === 7) return null;
  return 'categoryId';
}

function buildDefaultLayout(fields) {
  const items = Object.entries(fields)
    .filter(([name, def]) => name && def && def.title)
    .sort((a, b) => (a[1].title || a[0]).localeCompare(b[1].title || b[0]))
    .map(([name]) => ({ name }));
  if (items.length === 0) return [];
  return [{ name: 'main', title: 'Главное', type: 'section', elements: items }];
}

async function tryGetLayout(method, params) {
  try {
    const res = await bxCall(method, params);
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.data)) return res.data;
    if (Array.isArray(res?.sections)) return res.sections;
    if (Array.isArray(res?.result)) return res.result;
    if (res && typeof res === 'object' && res.type === 'section') return [res];
    return [];
  } catch (e) {
    console.warn('[FieldsMap]', method, params, 'ERROR:', e.message);
    return [];
  }
}

const FIELD_TYPE_LABELS_RU = {
  string: 'Текст', text: 'Текст (многостр.)', integer: 'Число', double: 'Число',
  boolean: 'Да/Нет', date: 'Дата', datetime: 'Дата+время', enumeration: 'Список',
  crm_status: 'Справочник', crm: 'CRM-объект', user: 'Сотрудник', employee: 'Сотрудник',
  iblock_section: 'Раздел', iblock_element: 'Элемент', file: 'Файл', url: 'Ссылка',
  money: 'Деньги', address: 'Адрес', char: 'Да/Нет', system: 'Системное',
};

function fieldTypeLabel(def) {
  if (!def) return '';
  if (def.isSystem) return 'Системное';
  const t = def.type || '';
  return FIELD_TYPE_LABELS_RU[t] || t;
}

const SYSTEM_FIELD_TITLES = {
  CLIENT: 'Клиент (контакт + компания)', OPPORTUNITY_WITH_CURRENCY: 'Сумма с валютой',
  PRODUCT_ROW_SUMMARY: 'Товары', RECURRING: 'Регулярная сделка', UTM: 'UTM-метки',
  OBSERVER: 'Наблюдатели', TRACKING_SOURCE_ID: 'Источник звонка', REQUISITES: 'Реквизиты',
  ADDRESS: 'Адрес', PHONE: 'Телефон', EMAIL: 'E-mail', WEB: 'Сайт', IM: 'Мессенджер', LINK: 'Ссылка',
};

function normKey(s) { return String(s || '').replace(/_/g, '').toLowerCase(); }

function buildFieldIndex(fields) {
  const idx = {};
  for (const [key, def] of Object.entries(fields)) idx[normKey(key)] = def;
  return idx;
}

function enrichFieldsWithLayoutEntries(fields, rawLayout) {
  const enriched = { ...fields };
  const idx = buildFieldIndex(fields);
  for (const sec of (rawLayout || [])) {
    if (sec?.type !== 'section') continue;
    for (const el of (sec.elements || [])) {
      const name = el?.name;
      if (!name || enriched[name]) continue;
      const existing = idx[normKey(name)];
      if (existing) enriched[name] = { ...existing };
      else enriched[name] = { title: SYSTEM_FIELD_TITLES[name] || name, type: 'system', isSystem: true };
    }
  }
  return enriched;
}

function normalizeLayout(rawLayout, fields) {
  return (rawLayout || [])
    .filter(s => s && s.type === 'section')
    .map(s => ({
      name: s.name || ('section_' + Math.random().toString(36).slice(2, 8)),
      title: s.title || s.name || 'Секция',
      elements: (s.elements || [])
        .filter(el => el && el.name)
        .map(el => ({
          name: el.name,
          optionFlags: el.optionFlags ?? '0',
          ...(el.title ? { title: el.title } : {}),
          ...(el.options ? { options: el.options } : {}),
        })),
    }));
}

function indexOverridesFromLayout(layout) {
  const out = {};
  for (const sec of (layout || [])) {
    for (const el of (sec.elements || [])) {
      if (el?.name && el.title) out[el.name] = el.title;
    }
  }
  return out;
}

// ---------- Render ----------
function renderAll() {
  renderSections();
  renderPool();
  bindSortables();
}

function fieldsInLayout() {
  const set = new Set();
  for (const s of state.layout) for (const el of s.elements) set.add(el.name);
  return set;
}

function renderPool() {
  const used = fieldsInLayout();
  const search = ($('#field-search').value || '').toLowerCase();
  const pool = $('#pool');
  pool.innerHTML = '';

  const available = Object.entries(state.fields)
    .filter(([name]) => !used.has(name))
    .filter(([name, def]) => {
      if (!search) return true;
      const t = (def.title || '').toLowerCase();
      return t.includes(search) || name.toLowerCase().includes(search);
    })
    .sort((a, b) => (a[1].title || a[0]).localeCompare(b[1].title || b[0]));

  if (available.length === 0) {
    pool.innerHTML = '<div class="empty">нет доступных полей</div>';
    return;
  }
  for (const [name, def] of available) pool.appendChild(buildFieldEl(name, def));
}

function renderSections() {
  const cont = $('#sections');
  cont.innerHTML = '';
  if (state.layout.length === 0) {
    cont.innerHTML = '<div class="empty">пусто. Нажми «+ Секция» чтобы начать.</div>';
    return;
  }
  for (const sec of state.layout) cont.appendChild(buildSectionEl(sec));
}

function buildFieldEl(name, def, opts = {}) {
  const tpl = $('#tpl-field').content.firstElementChild.cloneNode(true);
  tpl.dataset.fieldName = name;

  const titleEl = tpl.querySelector('.field__title');
  const sysTitle = def?.title || name;
  const overrideTitle = state.fieldOverrides[name] ? String(state.fieldOverrides[name]) : '';
  if (overrideTitle && overrideTitle !== sysTitle) {
    titleEl.textContent = truncate(overrideTitle, 20);
    titleEl.title = overrideTitle + ' (системное: ' + sysTitle + ')';
    const sysSpan = document.createElement('span');
    sysSpan.className = 'field__title-sys';
    sysSpan.textContent = '(' + truncate(sysTitle, 20) + ')';
    sysSpan.title = 'Системное имя поля: ' + sysTitle;
    titleEl.appendChild(document.createTextNode(' '));
    titleEl.appendChild(sysSpan);
  } else {
    titleEl.textContent = truncate(sysTitle, 20);
    titleEl.title = sysTitle;
  }

  const nameEl = tpl.querySelector('.field__name');
  nameEl.textContent = truncate(name, 20);
  nameEl.title = name;

  const typeLbl = fieldTypeLabel(def);
  const typeEl = tpl.querySelector('.field__type');
  if (typeLbl) {
    typeEl.textContent = truncate(typeLbl, 20);
    typeEl.title = 'Тип поля: ' + typeLbl;
  } else {
    typeEl.remove();
  }

  const multiEl = tpl.querySelector('.field__multi');
  if (!def?.isMultiple) multiEl.remove();
  if (def?.isSystem) tpl.classList.add('field--system');

  const editBtn = tpl.querySelector('.field__edit');
  const toggle  = tpl.querySelector('.field__show-toggle');
  const removeBtn = tpl.querySelector('.field__remove');

  if (opts.inSection && opts.element) {
    editBtn.dataset.fieldName = name;
    const showAlways = fieldShowAlways(opts.element);
    toggle.classList.toggle('field__show-toggle--on', showAlways);
    toggle.dataset.fieldName = name;
    toggle.dataset.sectionName = opts.sectionName || '';
    removeBtn.dataset.fieldName = name;
    removeBtn.dataset.sectionName = opts.sectionName || '';
  } else {
    editBtn.remove();
    toggle.remove();
    removeBtn.remove();
  }
  return tpl;
}

function buildSectionEl(sec) {
  const tpl = $('#tpl-section').content.firstElementChild.cloneNode(true);
  tpl.dataset.sectionId = sec.name;
  const titleInput = tpl.querySelector('.section__title');
  titleInput.value = sec.title;
  titleInput.addEventListener('input', () => { sec.title = titleInput.value; markDirty(); });

  tpl.querySelector('.section__remove').addEventListener('click', () => {
    if (sec.elements.length > 0) {
      if (!confirm(`Удалить секцию «${sec.title}» вместе с ${sec.elements.length} полями? Поля вернутся в пул.`)) return;
    }
    state.layout = state.layout.filter(s => s !== sec);
    renderAll();
    markDirty();
  });

  const fieldsBox = tpl.querySelector('.section__fields');
  for (const el of sec.elements) {
    const def = state.fields[el.name];
    if (def) fieldsBox.appendChild(buildFieldEl(el.name, def, { inSection: true, sectionName: sec.name, element: el }));
  }
  return tpl;
}

const OPT_FLAG_SHOW_ALWAYS = 1;

function fieldShowAlways(el) {
  const flags = Number(el.optionFlags || 0);
  if ((flags & OPT_FLAG_SHOW_ALWAYS) === OPT_FLAG_SHOW_ALWAYS) return true;
  const o = el.options || {};
  return o.showAlways === true || o.showAlways === 'Y' || o.showAlways === 'true';
}

function setFieldShowAlways(el, on) {
  let flags = Number(el.optionFlags || 0);
  if (on) flags |= OPT_FLAG_SHOW_ALWAYS;
  else flags &= ~OPT_FLAG_SHOW_ALWAYS;
  el.optionFlags = String(flags);

  const opts = { ...(el.options || {}) };
  if (on) opts.showAlways = true;
  else delete opts.showAlways;
  if (Object.keys(opts).length > 0) el.options = opts;
  else delete el.options;
}

function bindFieldEditButton() {
  $('#sections').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.field__edit');
    if (editBtn) {
      e.stopPropagation();
      const name = editBtn.dataset.fieldName || editBtn.closest('.field')?.dataset.fieldName;
      if (name) openFieldEditor(name);
      return;
    }
    const rmBtn = e.target.closest('.field__remove');
    if (rmBtn) {
      e.stopPropagation();
      const fieldEl = rmBtn.closest('.field');
      const sectionEl = rmBtn.closest('.section');
      if (!fieldEl || !sectionEl) return;
      const sec = state.layout.find(s => s.name === sectionEl.dataset.sectionId);
      if (!sec) return;
      sec.elements = sec.elements.filter(x => x.name !== fieldEl.dataset.fieldName);
      renderAll();
      markDirty();
    }
  });
}

function bindModalEvents() {
  $('#btn-field-cancel').addEventListener('click', closeFieldEditor);
  $('#btn-field-close').addEventListener('click', closeFieldEditor);
  $('#btn-field-apply').addEventListener('click', applyFieldEdit);
  $('#btn-field-delete').addEventListener('click', deleteCurrentField);
  $('#modal-edit-field').querySelector('.modal__backdrop').addEventListener('click', closeFieldEditor);
  $('#btn-add-list-value').addEventListener('click', addPendingListValue);
  $('#field-edit-list-new').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPendingListValue(); }
  });

  $('#btn-portal-cancel').addEventListener('click', closePortalModal);
  $('#btn-portal-close').addEventListener('click', closePortalModal);
  $('#btn-portal-save').addEventListener('click', savePortal);
  $('#modal-new-portal').querySelector('.modal__backdrop').addEventListener('click', closePortalModal);

  // Создание поля.
  $('#cf-type').innerHTML = CREATABLE_TYPES.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  $('#cf-type').addEventListener('change', () => {
    $('#cf-row-list').classList.toggle('hidden', $('#cf-type').value !== 'enumeration');
  });
  $('#cf-title').addEventListener('input', () => {
    // Авто-генерим FIELD_NAME, пока пользователь не правил его руками.
    const nameInp = $('#cf-name');
    if (!nameInp.dataset.touched) nameInp.value = fieldNameFromTitle($('#cf-title').value);
  });
  $('#cf-name').addEventListener('input', () => { $('#cf-name').dataset.touched = '1'; });
  $('#btn-cf-cancel').addEventListener('click', closeCreateFieldModal);
  $('#btn-cf-close').addEventListener('click',  closeCreateFieldModal);
  $('#btn-cf-save').addEventListener('click',   submitCreateField);
  $('#modal-create-field').querySelector('.modal__backdrop').addEventListener('click', closeCreateFieldModal);

  // Массовая заливка.
  $('#bulk-text').addEventListener('input', reparseBulk);
  $('#btn-bulk-cancel').addEventListener('click', closeBulkModal);
  $('#btn-bulk-close').addEventListener('click',  closeBulkModal);
  $('#btn-bulk-save').addEventListener('click',   submitBulk);
  $('#modal-bulk-fields').querySelector('.modal__backdrop').addEventListener('click', closeBulkModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#modal-edit-field').classList.contains('hidden')) closeFieldEditor();
      if (!$('#modal-new-portal').classList.contains('hidden')) closePortalModal();
      if (!$('#modal-create-field').classList.contains('hidden')) closeCreateFieldModal();
      if (!$('#modal-bulk-fields').classList.contains('hidden')) closeBulkModal();
    }
  });
}

function bindShowToggle() {
  $('#sections').addEventListener('click', (e) => {
    const btn = e.target.closest('.field__show-toggle');
    if (!btn) return;
    e.stopPropagation();
    const fieldEl = btn.closest('.field');
    const sectionEl = btn.closest('.section');
    if (!fieldEl || !sectionEl) return;
    const sec = state.layout.find(s => s.name === sectionEl.dataset.sectionId);
    const el  = sec?.elements.find(x => x.name === fieldEl.dataset.fieldName);
    if (!el) return;
    const next = !fieldShowAlways(el);
    setFieldShowAlways(el, next);
    btn.classList.toggle('field__show-toggle--on', next);
    markDirty();
  });
}

// ---------- Drag-n-drop ----------
const sortableInstances = [];

function bindSortables() {
  while (sortableInstances.length) sortableInstances.pop().destroy();

  sortableInstances.push(new Sortable($('#pool'), {
    group: { name: 'fields', pull: true, put: true },
    animation: 150, ghostClass: 'sortable-ghost',
    filter: '.no-drag', preventOnFilter: false,
    onAdd: () => { syncLayoutFromDom(); markDirty(); },
  }));

  for (const secEl of document.querySelectorAll('.section__fields')) {
    sortableInstances.push(new Sortable(secEl, {
      group: { name: 'fields', pull: true, put: true },
      animation: 150, ghostClass: 'sortable-ghost',
      filter: '.no-drag', preventOnFilter: false,
      onAdd:    () => { syncLayoutFromDom(); markDirty(); },
      onUpdate: () => { syncLayoutFromDom(); markDirty(); },
      onRemove: () => { syncLayoutFromDom(); markDirty(); },
    }));
  }

  sortableInstances.push(new Sortable($('#sections'), {
    group: 'sections', handle: '.section__head .drag-handle',
    animation: 150,
    onUpdate: () => { syncSectionsOrderFromDom(); markDirty(); },
  }));
}

function syncLayoutFromDom() {
  const prev = new Map();
  for (const sec of state.layout) for (const el of sec.elements) prev.set(el.name, el);
  for (const secEl of document.querySelectorAll('.section')) {
    const secId = secEl.dataset.sectionId;
    const sec = state.layout.find(s => s.name === secId);
    if (!sec) continue;
    sec.elements = Array.from(secEl.querySelectorAll('.section__fields > .field'))
      .map(f => prev.get(f.dataset.fieldName) || { name: f.dataset.fieldName, optionFlags: '0' });
  }
  setTimeout(() => renderAll(), 0);
}

function syncSectionsOrderFromDom() {
  const order = Array.from(document.querySelectorAll('.section')).map(s => s.dataset.sectionId);
  state.layout.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

function toggleCollapseSections() {
  state.collapseSections = !state.collapseSections;
  document.body.classList.toggle('collapse-sections', state.collapseSections);
  $('#btn-move-sections').classList.toggle('btn--on', state.collapseSections);
}

// ---------- Действия ----------
function addSection() {
  const name = 'section_' + Date.now().toString(36);
  state.layout.push({ name, title: 'Новая секция', elements: [] });
  renderAll();
  markDirty();
}

async function saveLayout() {
  if (!state.current) return;
  $('#btn-save').disabled = true;
  setStatus('Сохранение…', 'info');

  const data = state.layout.map(s => ({
    name: s.name,
    title: s.title || s.name,
    type: 'section',
    elements: s.elements.map(el => {
      const out = {
        name: el.name,
        optionFlags: el.optionFlags ?? '0',
        ...(el.options ? { options: el.options } : {}),
      };
      const ov = state.fieldOverrides[el.name];
      if (ov) out.title = ov;
      return out;
    }),
  }));

  const params = { entityTypeId: state.current.entityTypeId, scope: SCOPE, data };
  if (state.extras && Object.keys(state.extras).length > 0) params.extras = state.extras;

  try {
    await bxCall('crm.item.details.configuration.set', params);
    state.dirty = false;
    setStatus('Сохранено ✓', 'ok');
  } catch (e) {
    setStatus('Ошибка сохранения: ' + e.message, 'err');
    $('#btn-save').disabled = false;
  }
}

async function resetLayout() {
  if (!state.current) return;
  if (!confirm('Сбросить раскладку до системной? Несохранённые изменения пропадут.')) return;

  const params = { entityTypeId: state.current.entityTypeId, scope: SCOPE };
  if (state.extras && Object.keys(state.extras).length > 0) params.extras = state.extras;

  try {
    await bxCall('crm.item.details.configuration.reset', params);
    setStatus('Сброшено. Перечитываю…', 'ok');
    await loadEntityData(state.current.entityTypeId);
  } catch (e) {
    setStatus('Ошибка сброса: ' + e.message, 'err');
  }
}

// ---------- userfield helpers ----------
function entityIdForUF(entityTypeId) {
  return ({ 1: 'CRM_LEAD', 2: 'CRM_DEAL', 3: 'CRM_CONTACT', 4: 'CRM_COMPANY', 7: 'CRM_QUOTE' })[entityTypeId] || `CRM_${entityTypeId}`;
}

function isUserField(name) { return /^UF_/.test(String(name || '')); }
function isListField(def) { return def && (def.type === 'enumeration') && Array.isArray(def.items); }

async function fetchUserfieldByName(entityTypeId, fieldName) {
  if (state.userfieldCache[fieldName]) return state.userfieldCache[fieldName];
  const entityId = entityIdForUF(entityTypeId);
  const arr = await bxListAll('userfieldconfig.list', { moduleId: 'crm', filter: { ENTITY_ID: entityId } });
  const found = arr.find(f => (f.FIELD_NAME || f.fieldName) === fieldName);
  if (!found) return null;
  const norm = {
    id: Number(found.ID || found.id),
    fieldName,
    userTypeId: found.USER_TYPE_ID || found.userTypeId,
    label: pickLabel(found.EDIT_FORM_LABEL ?? found.editFormLabel),
    listLabel: pickLabel(found.LIST_COLUMN_LABEL ?? found.listColumnLabel),
    filterLabel: pickLabel(found.LIST_FILTER_LABEL ?? found.listFilterLabel),
    listItems: normalizeListItems(found.LIST ?? found.list ?? found.ENUM ?? found.enum),
    raw: found,
  };
  state.userfieldCache[fieldName] = norm;
  return norm;
}

function pickLabel(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.ru || v.RU || v.en || v.EN || Object.values(v)[0] || '';
  return String(v);
}

function normalizeListItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(it => ({
    ID: it.ID || it.id,
    VALUE: it.VALUE ?? it.value ?? '',
    DEF: it.DEF ?? it.def ?? 'N',
    SORT: Number(it.SORT ?? it.sort ?? 0) || 0,
  })).filter(it => it.ID != null);
}

async function updateUserfield(id, patch) {
  return bxCall('userfieldconfig.update', { moduleId: 'crm', id, field: patch });
}

// ---------- Field edit modal ----------
const editState = {
  fieldName: null,
  uf: null,
  pendingNewValues: [],
  listOverrides: {},      // { [ID]: 'new value' } — переименование значений списка
  listDeletions: new Set(), // Set<string ID> — удаление значений списка
};

function openFieldEditor(fieldName) {
  const def = state.fields[fieldName];
  if (!def) return;
  editState.fieldName = fieldName;
  editState.uf = null;
  editState.pendingNewValues = [];
  editState.listOverrides = {};
  editState.listDeletions = new Set();

  $('#field-edit-override').value = state.fieldOverrides[fieldName] || '';
  $('#field-edit-system').value = '';
  $('#field-edit-system-readonly').textContent = def.title || fieldName;
  $('#field-edit-list-items').innerHTML = '';
  $('#field-edit-list-new').value = '';
  $('#form-row-list').classList.add('hidden');
  $('#fe-help').value = '';
  setEditStatus(null);

  const canEditSystem = isUserField(fieldName) && !def.isSystem;
  if (!canEditSystem) {
    $('#form-row-system').classList.add('hidden');
    $('#form-row-readonly-system').classList.remove('hidden');
    $('#form-row-flags').classList.add('hidden');
    $('#form-row-help').classList.add('hidden');
    $('#btn-field-delete').classList.add('hidden');
  } else {
    $('#form-row-system').classList.remove('hidden');
    $('#form-row-readonly-system').classList.add('hidden');
    $('#field-edit-system').value = def.title || '';
    $('#form-row-flags').classList.remove('hidden');
    $('#form-row-help').classList.remove('hidden');
    $('#btn-field-delete').classList.remove('hidden');
    $('#btn-field-delete').disabled = false;
    // Дефолты до загрузки uf — после lazy-load заполнятся настоящими значениями.
    $('#fe-mandatory').checked  = false;
    $('#fe-showfilter').checked = false;
    $('#fe-showinlist').checked = true;
    $('#fe-editinlist').checked = true;
    if (isListField(def)) {
      $('#form-row-list').classList.remove('hidden');
      renderListItems(def.items.map(it => ({ ID: it.ID, VALUE: it.VALUE })));
    }
    lazyLoadUserfield();
  }

  $('#modal-edit-field').classList.remove('hidden');
  $('#modal-edit-field').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#field-edit-override').focus(), 0);
}

async function lazyLoadUserfield() {
  if (!state.current) return;
  try {
    const uf = await fetchUserfieldByName(state.current.entityTypeId, editState.fieldName);
    if (!uf) {
      setEditStatus('Не нашёл userfield в Б24 — переименовать/удалить и менять флаги нельзя.', 'err');
      return;
    }
    editState.uf = uf;
    const r = uf.raw || {};
    const truthy = v => v === 'Y' || v === 'I' || v === true;
    const ynOrDefaultY = v => v === undefined ? true : truthy(v);
    $('#fe-mandatory').checked  = truthy(r.MANDATORY)   || truthy(r.mandatory);
    $('#fe-showfilter').checked = truthy(r.SHOW_FILTER) || truthy(r.showFilter);
    $('#fe-showinlist').checked = ynOrDefaultY(r.SHOW_IN_LIST ?? r.showInList);
    $('#fe-editinlist').checked = ynOrDefaultY(r.EDIT_IN_LIST ?? r.editInList);
    $('#fe-help').value = pickLabel(r.HELP_MESSAGE ?? r.helpMessage) || '';
    if (isListField(state.fields[editState.fieldName])) renderListItems(uf.listItems);
  } catch (e) {
    console.warn(e);
    setEditStatus('Не удалось получить userfield: ' + e.message, 'err');
  }
}

function renderListItems(items) {
  const ul = $('#field-edit-list-items');
  ul.innerHTML = '';
  for (const it of items) {
    const idStr = String(it.ID);
    if (editState.listDeletions.has(idStr)) continue;
    const renamed = editState.listOverrides[idStr];
    const displayValue = renamed != null ? renamed : (it.VALUE ?? '');
    const li = document.createElement('li');
    if (renamed != null) li.classList.add('list-values__renamed');
    li.innerHTML = `<span class="list-values__id">#${escapeHtml(String(it.ID ?? '?'))}</span>
                    <span class="list-values__val"></span>
                    <button type="button" class="list-values__edit no-drag" title="Переименовать">✎</button>
                    <button type="button" class="list-values__remove no-drag" title="Удалить значение">✕</button>`;
    li.querySelector('.list-values__val').textContent = displayValue;
    li.querySelector('.list-values__edit').addEventListener('click', () => {
      const v = prompt('Новое значение:', displayValue);
      if (v == null) return;
      const t = v.trim();
      if (!t || t === (it.VALUE ?? '')) delete editState.listOverrides[idStr];
      else editState.listOverrides[idStr] = t;
      renderListItems(items);
    });
    li.querySelector('.list-values__remove').addEventListener('click', () => {
      if (confirm('Удалить значение «' + displayValue + '»? В карточках, где оно выбрано, поле станет пустым.')) {
        editState.listDeletions.add(idStr);
        renderListItems(items);
      }
    });
    ul.appendChild(li);
  }
  for (const v of editState.pendingNewValues) {
    const li = document.createElement('li');
    li.className = 'list-values__new';
    li.innerHTML = `<span class="list-values__id">new</span><span class="list-values__val"></span>
                    <button type="button" class="list-values__remove no-drag" title="Убрать из списка добавления">✕</button>`;
    li.querySelector('.list-values__val').textContent = v;
    li.querySelector('.list-values__remove').addEventListener('click', () => {
      editState.pendingNewValues = editState.pendingNewValues.filter(x => x !== v);
      const baseItems = editState.uf?.listItems
        ?? (state.fields[editState.fieldName]?.items || []).map(it => ({ ID: it.ID, VALUE: it.VALUE }));
      renderListItems(baseItems);
    });
    ul.appendChild(li);
  }
}

function addPendingListValue() {
  const inp = $('#field-edit-list-new');
  const v = (inp.value || '').trim();
  if (!v) return;
  if (editState.pendingNewValues.includes(v)) { setEditStatus('Уже в списке добавления.', 'info'); return; }
  const existing = editState.uf?.listItems
    ?? (state.fields[editState.fieldName]?.items || []).map(it => ({ ID: it.ID, VALUE: it.VALUE }));
  if (existing.some(it => String(it.VALUE) === v)) { setEditStatus('Такое значение уже есть в списке.', 'info'); return; }
  editState.pendingNewValues.push(v);
  inp.value = '';
  renderListItems(existing);
  inp.focus();
}

function setEditStatus(msg, kind = 'info') {
  const el = $('#field-edit-status');
  if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.className = 'status ' + kind;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function closeFieldEditor() {
  $('#modal-edit-field').classList.add('hidden');
  $('#modal-edit-field').setAttribute('aria-hidden', 'true');
  editState.fieldName = null;
  editState.uf = null;
  editState.pendingNewValues = [];
  editState.listOverrides = {};
  editState.listDeletions = new Set();
}

async function applyFieldEdit() {
  const name = editState.fieldName;
  if (!name) return;
  const def = state.fields[name];
  const overrideRaw = ($('#field-edit-override').value || '').trim();
  const sysRaw      = ($('#field-edit-system').value   || '').trim();

  const oldOverride = state.fieldOverrides[name] || '';
  if (oldOverride !== overrideRaw) {
    if (overrideRaw) state.fieldOverrides[name] = overrideRaw;
    else delete state.fieldOverrides[name];
    markDirty();
  }

  const canEditSystem = isUserField(name) && !def.isSystem;
  const wantSystemRename  = canEditSystem && sysRaw && sysRaw !== (def.title || '');
  const wantListEdit      = canEditSystem && isListField(def) && (
    editState.pendingNewValues.length > 0 ||
    Object.keys(editState.listOverrides).length > 0 ||
    editState.listDeletions.size > 0
  );

  // Сравниваем флаги/help с тем, что в uf.raw — отправляем в patch только дельту.
  let flagPatch = {};
  if (canEditSystem && editState.uf) {
    const r = editState.uf.raw || {};
    const truthy = v => v === 'Y' || v === 'I' || v === true;
    const yDefaultTrue = v => v === undefined ? true : truthy(v);
    const cur = {
      mandatory:  truthy(r.MANDATORY)   || truthy(r.mandatory),
      showFilter: truthy(r.SHOW_FILTER) || truthy(r.showFilter),
      showInList: yDefaultTrue(r.SHOW_IN_LIST ?? r.showInList),
      editInList: yDefaultTrue(r.EDIT_IN_LIST ?? r.editInList),
      help:       (pickLabel(r.HELP_MESSAGE ?? r.helpMessage) || '').trim(),
    };
    const next = {
      mandatory:  $('#fe-mandatory').checked,
      showFilter: $('#fe-showfilter').checked,
      showInList: $('#fe-showinlist').checked,
      editInList: $('#fe-editinlist').checked,
      help:       ($('#fe-help').value || '').trim(),
    };
    if (cur.mandatory  !== next.mandatory)  flagPatch.mandatory   = next.mandatory  ? 'Y' : 'N';
    if (cur.showFilter !== next.showFilter) flagPatch.showFilter  = next.showFilter ? 'Y' : 'N';
    if (cur.showInList !== next.showInList) flagPatch.showInList  = next.showInList ? 'Y' : 'N';
    if (cur.editInList !== next.editInList) flagPatch.editInList  = next.editInList ? 'Y' : 'N';
    if (cur.help       !== next.help)       flagPatch.helpMessage = { ru: next.help };
  }
  const wantFlagChange = Object.keys(flagPatch).length > 0;

  if (wantSystemRename || wantListEdit || wantFlagChange) {
    setEditStatus('Сохраняю в Б24…', 'info');
    $('#btn-field-apply').disabled = true;
    try {
      if (!editState.uf) await lazyLoadUserfield();
      if (!editState.uf) throw new Error('userfield не найден в Б24');

      const patch = { ...flagPatch };
      if (wantSystemRename) {
        patch.editFormLabel   = { ru: sysRaw };
        patch.listColumnLabel = { ru: sysRaw };
        patch.listFilterLabel = { ru: sysRaw };
      }
      if (wantListEdit) {
        const maxSort = editState.uf.listItems.reduce((m, it) => Math.max(m, it.SORT || 0), 0);
        const merged = [];
        for (const it of editState.uf.listItems) {
          if (editState.listDeletions.has(String(it.ID))) continue;
          const value = editState.listOverrides[String(it.ID)] ?? it.VALUE;
          merged.push({ ID: it.ID, VALUE: value, DEF: it.DEF || 'N', SORT: it.SORT || 0 });
        }
        editState.pendingNewValues.forEach((v, i) => {
          merged.push({ VALUE: v, DEF: 'N', SORT: maxSort + (i + 1) * 10 });
        });
        patch.LIST = merged;
      }

      await updateUserfield(editState.uf.id, patch);

      if (wantSystemRename) state.fields[name] = { ...def, title: sysRaw };
      if (wantListEdit) state.userfieldCache[name] = null;

      setEditStatus(null);
      closeFieldEditor();
      setStatus('Сохранено в Б24 ✓ — перечитываю…', 'ok');
      $('#btn-field-apply').disabled = false;
      // Перечитываем сущность, чтобы UI увидел свежие значения списка/флаги.
      if (wantListEdit || wantFlagChange) await loadEntityData(state.current.entityTypeId);
      else renderAll();
      return;
    } catch (e) {
      console.error(e);
      setEditStatus('Ошибка: ' + e.message, 'err');
      $('#btn-field-apply').disabled = false;
      return;
    }
  }

  renderAll();
  closeFieldEditor();
}

// ============================================================
// CREATE / DELETE / BULK userfields
// ============================================================

const CREATABLE_TYPES = [
  { id: 'string',      label: 'Строка' },
  { id: 'integer',     label: 'Целое число' },
  { id: 'double',      label: 'Дробное число' },
  { id: 'date',        label: 'Дата' },
  { id: 'datetime',    label: 'Дата+время' },
  { id: 'boolean',     label: 'Да/Нет' },
  { id: 'enumeration', label: 'Список' },
  { id: 'money',       label: 'Деньги' },
  { id: 'url',         label: 'Ссылка' },
  { id: 'file',        label: 'Файл' },
  { id: 'address',     label: 'Адрес' },
  { id: 'employee',    label: 'Сотрудник' },
];

const TRANSLIT_MAP = {
  'а':'A','б':'B','в':'V','г':'G','д':'D','е':'E','ё':'YO','ж':'ZH','з':'Z','и':'I','й':'Y',
  'к':'K','л':'L','м':'M','н':'N','о':'O','п':'P','р':'R','с':'S','т':'T','у':'U','ф':'F',
  'х':'KH','ц':'TS','ч':'CH','ш':'SH','щ':'SCH','ъ':'','ы':'Y','ь':'','э':'E','ю':'YU','я':'YA',
};

function transliterate(s) {
  return String(s || '').toLowerCase().split('').map(c => {
    if (TRANSLIT_MAP[c] !== undefined) return TRANSLIT_MAP[c];
    if (/[a-z0-9]/i.test(c)) return c.toUpperCase();
    return ' ';
  }).join('').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

function fieldNameFromTitle(title) {
  const t = transliterate(title).slice(0, 30);
  if (!t) return 'UF_AUTO_' + Math.random().toString(36).slice(2, 8).toUpperCase();
  return /^UF_/.test(t) ? t : 'UF_' + t;
}

// Порядок важен: более специфичные паттерны раньше общих (datetime до date, double до integer).
const BULK_TYPE_PATTERNS = [
  { type: 'datetime',    re: /(дата.{0,3}врем|datetime)/i },
  { type: 'date',        re: /\b(дата|date)\b/i },
  { type: 'enumeration', re: /(список|enum(eration)?|выбор|select|варианты?)/i },
  { type: 'boolean',     re: /(да\s*\/\s*нет|булев|boolean|bool|флаг|чекбокс|checkbox)/i },
  { type: 'double',      re: /(дроб(ное|ь)|double|float|вещественное)/i },
  { type: 'money',       re: /(деньги|money|сумма|валюта|price|цена)/i },
  { type: 'integer',     re: /(целое|число|integer|\bint\b|number|кол.{0,2}во|количество)/i },
  { type: 'url',         re: /(ссылка|\burl\b|link)/i },
  { type: 'file',        re: /(файл|file)/i },
  { type: 'address',     re: /(адрес|address)/i },
  { type: 'employee',    re: /(сотрудник|employee|пользователь|\buser\b)/i },
  { type: 'string',      re: /(текст|строка|string|text)/i },
];

function parseBulkLine(rawLine) {
  let line = String(rawLine || '').trim();
  if (!line) return null;

  // 1) Бракет-листы [...] / (...) — приоритет.
  let listValues = null;
  const bracketMatch = line.match(/[\[\(]([^\]\)]+)[\]\)]/);
  if (bracketMatch) {
    const inside = bracketMatch[1];
    let parts = inside.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) parts = inside.split('/').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      listValues = parts;
      line = (line.slice(0, bracketMatch.index) + ' ' + line.slice(bracketMatch.index + bracketMatch[0].length)).trim();
    }
  }

  // 2) Имя — тип/значения через разделители.
  const sepMatch = line.match(/^(.+?)\s*[—\-:→=|]\s*(.+)$/);
  let titlePart = line, rest = '';
  if (sepMatch) { titlePart = sepMatch[1].trim(); rest = sepMatch[2].trim(); }

  // 3) Тип — ищем сначала в rest, потом в title.
  let detectedType = null, typeKeyword = null;
  for (const h of [rest, titlePart]) {
    if (!h) continue;
    for (const p of BULK_TYPE_PATTERNS) {
      const m = h.match(p.re);
      if (m) { detectedType = p.type; typeKeyword = m[0]; break; }
    }
    if (detectedType) break;
  }

  // 4) Если списка ещё нет — пытаемся из rest после удаления типа.
  if (!listValues && rest) {
    const restNoType = typeKeyword ? rest.replace(typeKeyword, '').trim() : rest;
    const cleaned = restNoType.replace(/^[\s\-—:→=|]+/, '').replace(/[\s\-—:→=|]+$/, '');
    if (/[,;]/.test(cleaned)) {
      const parts = cleaned.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) listValues = parts;
    } else if (cleaned.includes('/')) {
      const parts = cleaned.split('/').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) listValues = parts;
    }
  }

  if (listValues && listValues.length >= 2) detectedType = 'enumeration';
  if (!detectedType) detectedType = 'string';

  // 5) Cleanup названия — уберём из него тип-слово и хвостовые разделители.
  let title = titlePart || rawLine.trim();
  if (typeKeyword) {
    const re = new RegExp('\\s*' + typeKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
    title = title.replace(re, '').trim();
  }
  title = title.replace(/[\s\-—:→=|]+$/, '').replace(/^[\s\-—:→=|]+/, '').trim();
  if (!title) title = rawLine.trim();

  return {
    title,
    userTypeId: detectedType,
    listValues: detectedType === 'enumeration' ? listValues : null,
    fieldName: fieldNameFromTitle(title),
  };
}

function parseBulkText(text) {
  return String(text || '').split(/\r?\n/).map(parseBulkLine).filter(Boolean);
}

function buildUserfieldPayload(p) {
  const field = {
    entityId:    p.entityId,
    fieldName:   p.fieldName,
    userTypeId:  p.userTypeId,
    multiple:    p.multiple    ? 'Y' : 'N',
    mandatory:   p.mandatory   ? 'Y' : 'N',
    showFilter:  p.showFilter  ? 'Y' : 'N',
    showInList:  p.showInList  === false ? 'N' : 'Y',
    editInList:  p.editInList  === false ? 'N' : 'Y',
    isSearchable: 'N',
    editFormLabel:   { ru: p.title },
    listColumnLabel: { ru: p.title },
    listFilterLabel: { ru: p.title },
    helpMessage:     { ru: p.help || '' },
  };
  if (p.userTypeId === 'enumeration' && Array.isArray(p.listValues)) {
    field.list = p.listValues.map((v, i) => ({ VALUE: v, DEF: 'N', SORT: (i + 1) * 10 }));
  }
  return { moduleId: 'crm', field };
}

async function addUserfield(payload) {
  return bxCall('userfieldconfig.add', buildUserfieldPayload(payload));
}

async function deleteUserfield(id) {
  return bxCall('userfieldconfig.delete', { moduleId: 'crm', id });
}

/** Не валится на первой ошибке — возвращает [{ ok: true, result } | { ok: false, error }]. */
async function bxBatchSafe(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 50) {
    const chunk = calls.slice(i, i + 50);
    const cmd = {};
    chunk.forEach((c, idx) => {
      const qs = c.params && Object.keys(c.params).length ? '?' + buildQuery(c.params) : '';
      cmd[`r${idx}`] = c.method + qs;
    });
    const data = await bxRaw('batch', { halt: 0, cmd });
    if (data.error) {
      chunk.forEach(() => out.push({ ok: false, error: data.error_description || data.error }));
      continue;
    }
    const result = data.result || {};
    const errs = result.result_error || {};
    chunk.forEach((_, idx) => {
      const e = errs[`r${idx}`];
      if (e) out.push({ ok: false, error: e.error_description || e.error || JSON.stringify(e) });
      else out.push({ ok: true, result: (result.result || {})[`r${idx}`] });
    });
  }
  return out;
}

async function addUserfieldsBulk(items) {
  const calls = items.map(p => ({ method: 'userfieldconfig.add', params: buildUserfieldPayload(p) }));
  return bxBatchSafe(calls);
}

// ---------- Create-field modal ----------

function openCreateFieldModal() {
  if (!state.current) { setStatus('Сначала выбери сущность.', 'err'); return; }
  $('#cf-title').value = '';
  $('#cf-name').value  = '';
  $('#cf-list').value  = '';
  $('#cf-multiple').checked   = false;
  $('#cf-mandatory').checked  = false;
  $('#cf-showfilter').checked = false;
  $('#cf-type').value = 'string';
  $('#cf-row-list').classList.add('hidden');
  $('#cf-status').classList.add('hidden');
  $('#btn-cf-save').disabled = false;
  $('#modal-create-field').classList.remove('hidden');
  $('#modal-create-field').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#cf-title').focus(), 0);
}

function closeCreateFieldModal() {
  $('#modal-create-field').classList.add('hidden');
  $('#modal-create-field').setAttribute('aria-hidden', 'true');
}

function setCfStatus(msg, kind = 'info') {
  const el = $('#cf-status');
  if (!msg) { el.classList.add('hidden'); return; }
  el.className = 'status ' + kind;
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function submitCreateField() {
  if (!state.current) return;
  const title = ($('#cf-title').value || '').trim();
  const name  = ($('#cf-name').value  || '').trim();
  const type  = $('#cf-type').value;
  if (!title) { setCfStatus('Укажи название.', 'err'); return; }
  if (!/^UF_[A-Z0-9_]+$/.test(name)) { setCfStatus('FIELD_NAME должен начинаться с UF_, далее заглавные/цифры/_.', 'err'); return; }
  let listValues = null;
  if (type === 'enumeration') {
    listValues = ($('#cf-list').value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (listValues.length === 0) { setCfStatus('Список — добавь хотя бы одно значение.', 'err'); return; }
  }
  $('#btn-cf-save').disabled = true;
  setCfStatus('Создаю в Б24…', 'info');
  try {
    await addUserfield({
      entityId:    entityIdForUF(state.current.entityTypeId),
      fieldName:   name,
      userTypeId:  type,
      title,
      multiple:    $('#cf-multiple').checked,
      mandatory:   $('#cf-mandatory').checked,
      showFilter:  $('#cf-showfilter').checked,
      listValues,
    });
    closeCreateFieldModal();
    setStatus('Поле «' + title + '» создано ✓ — перечитываю…', 'ok');
    await loadEntityData(state.current.entityTypeId);
  } catch (e) {
    setCfStatus('Ошибка: ' + e.message, 'err');
    $('#btn-cf-save').disabled = false;
  }
}

// ---------- Bulk modal ----------

let bulkParsed = [];

function openBulkModal() {
  if (!state.current) { setStatus('Сначала выбери сущность.', 'err'); return; }
  $('#bulk-text').value = '';
  $('#bulk-status').classList.add('hidden');
  $('#bulk-preview').innerHTML = '<div class="empty muted">пусто — вставь поля выше</div>';
  $('#btn-bulk-save').disabled = true;
  bulkParsed = [];
  $('#modal-bulk-fields').classList.remove('hidden');
  $('#modal-bulk-fields').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#bulk-text').focus(), 0);
}

function closeBulkModal() {
  $('#modal-bulk-fields').classList.add('hidden');
  $('#modal-bulk-fields').setAttribute('aria-hidden', 'true');
}

function setBulkStatus(msg, kind = 'info') {
  const el = $('#bulk-status');
  if (!msg) { el.classList.add('hidden'); return; }
  el.className = 'status ' + kind;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function reparseBulk() {
  bulkParsed = parseBulkText($('#bulk-text').value);
  renderBulkPreview();
}

function renderBulkPreview() {
  const cont = $('#bulk-preview');
  if (!bulkParsed.length) {
    cont.innerHTML = '<div class="empty muted">пусто — вставь поля выше</div>';
    $('#btn-bulk-save').disabled = true;
    return;
  }
  let html = '<table class="bulk-table"><thead><tr><th></th><th>Название</th><th>FIELD_NAME</th><th>Тип</th><th>Значения</th></tr></thead><tbody>';
  bulkParsed.forEach((it, i) => {
    const typeLbl = (CREATABLE_TYPES.find(t => t.id === it.userTypeId) || {}).label || it.userTypeId;
    const chips = (it.listValues || []).map(v => `<span class="chip">${escapeHtml(v)}</span>`).join(' ');
    html += `<tr data-i="${i}">
      <td><input type="checkbox" class="bulk-pick" checked /></td>
      <td>${escapeHtml(it.title)}</td>
      <td><code>${escapeHtml(it.fieldName)}</code></td>
      <td>${escapeHtml(typeLbl)}</td>
      <td>${chips}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  cont.innerHTML = html;
  $('#btn-bulk-save').disabled = false;
}

async function submitBulk() {
  if (!state.current || !bulkParsed.length) return;
  const checks = [...$('#bulk-preview').querySelectorAll('.bulk-pick')];
  const items = bulkParsed
    .map((it, i) => ({ ...it, _picked: checks[i]?.checked }))
    .filter(it => it._picked)
    .map(it => ({
      entityId:   entityIdForUF(state.current.entityTypeId),
      fieldName:  it.fieldName,
      userTypeId: it.userTypeId,
      title:      it.title,
      listValues: it.listValues,
      multiple: false, mandatory: false, showFilter: false,
    }));
  if (!items.length) { setBulkStatus('Ничего не отмечено.', 'err'); return; }
  $('#btn-bulk-save').disabled = true;
  setBulkStatus('Создаю ' + items.length + ' полей в Б24 (батчем)…', 'info');
  try {
    const results = await addUserfieldsBulk(items);
    const ok  = results.filter(r => r.ok).length;
    const err = results.length - ok;
    if (err === 0) {
      closeBulkModal();
      setStatus(`Создано ${ok} полей ✓ — перечитываю…`, 'ok');
      await loadEntityData(state.current.entityTypeId);
    } else {
      const errMsgs = results
        .map((r, i) => r.ok ? null : `«${items[i].title}»: ${r.error}`)
        .filter(Boolean).slice(0, 5).join('; ');
      setBulkStatus(`Создано ${ok} из ${results.length}. Ошибки: ${errMsgs}${err > 5 ? ' …' : ''}`, 'err');
      $('#btn-bulk-save').disabled = false;
      if (ok > 0) await loadEntityData(state.current.entityTypeId);
    }
  } catch (e) {
    setBulkStatus('Ошибка: ' + e.message, 'err');
    $('#btn-bulk-save').disabled = false;
  }
}

// ---------- Delete current field (вызывается из field-edit модалки) ----------

async function deleteCurrentField() {
  const name = editState.fieldName;
  if (!name || !state.current) return;
  if (!isUserField(name)) return;
  if (!editState.uf) await lazyLoadUserfield();
  if (!editState.uf) { setEditStatus('Не нашёл userfield в Б24 — удалить нельзя.', 'err'); return; }
  const def = state.fields[name];
  if (!confirm(`Удалить поле «${def?.title || name}» (${name}) с портала «${state.portal.name}»?\nВсе данные в этом поле пропадут безвозвратно.`)) return;
  $('#btn-field-delete').disabled = true;
  setEditStatus('Удаляю…', 'info');
  try {
    await deleteUserfield(editState.uf.id);
    closeFieldEditor();
    setStatus('Поле удалено ✓ — перечитываю…', 'ok');
    await loadEntityData(state.current.entityTypeId);
  } catch (e) {
    setEditStatus('Ошибка удаления: ' + e.message, 'err');
    $('#btn-field-delete').disabled = false;
  }
}

// ---------- Init ----------
applyTheme(currentTheme());

document.addEventListener('DOMContentLoaded', async () => {
  Dropdown($('#dd-portal'), {
    options: [],
    searchable: true,
    placeholder: 'выбрать портал…',
    onChange: (v) => { if (v && v !== '__none__') selectPortal(v); },
  });
  $('#dd-portal').addEventListener('action', (e) => {
    if (e.detail.action === 'delete') handleDeletePortal(e.detail.value);
  });

  Dropdown($('#dd-entity'), {
    options: [{ group: '…', items: [] }],
    searchable: true,
    placeholder: 'выбрать сущность…',
    onChange: async (v) => {
      if (!confirmIfDirty()) { $('#dd-entity').__dd.setValue(state.current?.entityTypeId || null); return; }
      const id = Number(v);
      state.current = state.entities.find(x => x.entityTypeId === id) || null;
      if (state.current) await loadEntityData(state.current.entityTypeId);
    },
  });

  Dropdown($('#dd-category'), {
    options: [],
    placeholder: 'воронка…',
    onChange: async (v) => {
      if (!confirmIfDirty()) { $('#dd-category').__dd.setValue(state.categoryId); return; }
      const id = Number(v);
      state.categoryId = id;
      const catKey = categoryKeyFor(state.current?.entityTypeId);
      if (catKey) state.extras = { [catKey]: id };
      localStorage.setItem('fieldsmap-cat-' + state.current.entityTypeId, String(id));
      await reloadLayoutOnly();
    },
  });

  $('#btn-add-section').addEventListener('click', addSection);
  $('#btn-move-sections').addEventListener('click', toggleCollapseSections);
  $('#btn-save').addEventListener('click', saveLayout);
  $('#btn-reset').addEventListener('click', resetLayout);
  $('#btn-reload').addEventListener('click', () => {
    if (!confirmIfDirty()) return;
    if (state.current) loadEntityData(state.current.entityTypeId);
  });
  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#btn-new-portal').addEventListener('click', openPortalModal);
  $('#btn-create-field').addEventListener('click', openCreateFieldModal);
  $('#btn-bulk-fields').addEventListener('click', openBulkModal);
  updateThemeIcon();
  $('#field-search').addEventListener('input', () => renderPool());
  bindShowToggle();
  bindFieldEditButton();
  bindModalEvents();

  if (!window.SESSION_TOKEN) {
    showAuthRequired();
    toggleEmptyScreen();
    return;
  }

  try {
    await loadPortals();
    rebuildPortalDropdown();
    const savedId = localStorage.getItem('fieldsmap-portal');
    const fallback = state.portals[0]?.id;
    const pick = (savedId && state.portals.find(p => p.id === savedId)) ? savedId : fallback;
    if (pick) {
      $('#dd-portal').__dd.setValue(pick);
      await selectPortal(pick);
    }
  } catch (e) {
    setStatus('Не удалось загрузить список порталов: ' + e.message, 'err');
  }

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
});
