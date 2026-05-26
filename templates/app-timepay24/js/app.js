const MONTHS = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['', 'ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН',
                      'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
const DOW = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

const GRADES = [
  { hours: 140, bonus: 90000 }, { hours: 130, bonus: 80000 },
  { hours: 120, bonus: 70000 }, { hours: 110, bonus: 60000 },
  { hours: 100, bonus: 50000 }, { hours:  90, bonus: 40000 },
  { hours:  80, bonus: 30000 }, { hours:  70, bonus: 20000 },
  { hours:  60, bonus: 10000 }, { hours:   0, bonus:     0 },
];

const DEFAULT_PORTAL_URL    = 'https://kiselevgroup.bitrix24.ru';

const state = {
  startDate: monthStart(),
  endDate:   monthEnd(),
  preset:    'thisMonth',
  monthsCache: new Map(),  // period "YYYY-MM" -> full API response
  pendingMonths: new Map(),// period -> in-flight fetch promise (dedupe)
  data: null,              // merged + date-filtered view
  portalUrl: DEFAULT_PORTAL_URL,
  trendLoading: false,
};

let chartTrend = null;
let loadSeq     = 0; // monotonic token — only the latest loadReport updates UI

// ─── Init ────────────────────────────────────────────────────────────────────

function init() {
  loadConfig();
  populateDatePickers();
  bindFilters();
  document.getElementById('btnRefreshQuick').addEventListener('click', onRefreshQuick);
  document.getElementById('btnRefreshFull').addEventListener('click', onRefreshFull);
  bindTooltip();
  bindSlideover();
  bindB24Links();
  startScanBannerPolling();
  loadReport().then(() => loadTrendInBackground());
}

// ─── Live scan progress banner ────────────────────────────────────────────────

// Exposed so onRefresh() can reset the suppression flag when a new scan starts.
let _bannerSuppressed = false;
let _bannerHideTimer  = null;
let _bannerPollId     = null;

function resetBannerForNewScan() {
  _bannerSuppressed = false;
  if (_bannerHideTimer) { clearTimeout(_bannerHideTimer); _bannerHideTimer = null; }
}

function startScanBannerPolling() {
  const banner = document.getElementById('scanBanner');
  const text   = document.getElementById('scanBannerText');
  const fill   = document.getElementById('scanBannerFill');
  if (!banner) return;

  async function tick() {
    try {
      const r = await fetch('/api/report/status', { cache: 'no-store' });
      const d = await r.json();
      const s = d.scan ?? {};
      const stage = s.stage;

      // Hide when: suppressed (we already handled done/error), or idle with data.
      if (_bannerSuppressed || ((stage === 'idle' || !stage) && d.entriesStored > 0)) {
        banner.hidden = true;
        return;
      }

      banner.hidden = false;
      banner.classList.toggle('scan-banner--done',  stage === 'done');
      banner.classList.toggle('scan-banner--error', stage === 'error');

      const isIncremental = s.incremental;
      const prefix = isIncremental ? `За ${s.incrementalDays ?? '?'} дн: ` : '';

      let pct = 0, label = '', eta = '';
      const elapsedSec = s.startedAt ? (Date.now() - new Date(s.startedAt).getTime()) / 1000 : 0;

      if (stage === 'listing') {
        pct = s.tasksTotal ? (s.tasksListed / s.tasksTotal) * 100 : 0;
        label = `${prefix}Просмотр задач: ${(s.tasksListed ?? 0).toLocaleString('ru')} из ${(s.tasksTotal ?? 0).toLocaleString('ru')}`;
        const rate = elapsedSec > 0 ? s.tasksListed / elapsedSec : 0;
        const listingLeft = rate > 0 ? (s.tasksTotal - s.tasksListed) / rate : null;
        if (!isIncremental) {
          const expectedCandidates = Math.round((s.tasksTotal ?? 0) * 0.15);
          const fetchingEst = expectedCandidates * 0.4;
          eta = listingLeft != null ? formatEta(listingLeft + fetchingEst) : '';
        } else {
          eta = listingLeft != null ? formatEta(listingLeft) : '';
        }
      } else if (stage === 'fetching') {
        pct = s.timeCandidates ? (s.timeFetched / s.timeCandidates) * 100 : 0;
        label = `${prefix}Сбор списаний: ${(s.timeFetched ?? 0).toLocaleString('ru')} из ${(s.timeCandidates ?? 0).toLocaleString('ru')} задач · найдено ${(s.entriesFound ?? 0).toLocaleString('ru')}`;
        const fetchingElapsed = s.fetchingStartedAt
          ? (Date.now() - new Date(s.fetchingStartedAt).getTime()) / 1000
          : elapsedSec;
        const rate = fetchingElapsed > 0 && s.timeFetched > 0 ? s.timeFetched / fetchingElapsed : 0;
        const left = rate > 0 ? (s.timeCandidates - s.timeFetched) / rate : null;
        eta = left != null ? formatEta(left) : '';
      } else if (stage === 'done') {
        pct = 100;
        label = `${isIncremental ? 'Обновление' : 'Скан'} завершён · ${(d.entriesStored ?? 0).toLocaleString('ru')} записей`;
      } else if (stage === 'error') {
        pct = 100;
        label = `Ошибка: ${s.error ?? 'неизвестная'}`;
      } else {
        label = 'Инициализация…';
      }

      fill.style.width = Math.min(100, Math.max(2, pct)) + '%';
      const etaHtml = eta ? ` · осталось ~${eta}` : '';
      text.innerHTML = `<span>${label}${etaHtml}</span><span>${pct.toFixed(0)}%</span>`;

      // After done/error: show for 8s, then suppress forever (until next scan).
      if ((stage === 'done' || stage === 'error') && !_bannerHideTimer) {
        _bannerHideTimer = setTimeout(() => {
          _bannerSuppressed = true;
          banner.hidden = true;
          _bannerHideTimer = null;
          if (stage === 'done') {
            // Flush month cache so next loadReport() fetches fresh data.
            state.monthsCache.clear();
            loadReport().then(() => loadTrendInBackground());
          }
          setBtnDisabled(false);
        }, 8000);
      }
    } catch {
      // transient network error — keep whatever was shown
    }
  }

  tick();
  _bannerPollId = setInterval(tick, 2000);
}

function formatEta(seconds) {
  if (!seconds || seconds < 0) return '';
  const m = Math.round(seconds / 60);
  if (m < 1) return 'меньше минуты';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `${h} ч ${rem} мин` : `${h} ч`;
}

function bindB24Links() {
  // Intercept clicks on [data-b24-path] anchors. If BX24 SDK is available
  // (inside a registered Bitrix24 iframe), route through it; otherwise let
  // the browser handle the link normally (new tab via target="_blank").
  document.addEventListener('click', ev => {
    const a = ev.target.closest('a[data-b24-path]');
    if (!a) return;
    if (typeof BX24 !== 'undefined' && BX24.openLink) {
      ev.preventDefault();
      try { BX24.openLink(a.dataset.b24Path); } catch { /* fall back to href */ window.open(a.href, '_blank', 'noopener'); }
    }
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.portalUrl) state.portalUrl = cfg.portalUrl;
  } catch { /* fall back to default */ }
}

function populateDatePickers() {
  document.getElementById('filterStart').value  = state.startDate;
  document.getElementById('filterEnd').value    = state.endDate;
  document.getElementById('filterPreset').value = state.preset;
}

function bindFilters() {
  document.getElementById('filterStart').addEventListener('change', e => {
    state.startDate = e.target.value;
    state.preset    = 'custom';
    document.getElementById('filterPreset').value = 'custom';
    loadReport();
  });
  document.getElementById('filterEnd').addEventListener('change', e => {
    state.endDate = e.target.value;
    state.preset  = 'custom';
    document.getElementById('filterPreset').value = 'custom';
    loadReport();
  });
  document.getElementById('filterPreset').addEventListener('change', e => {
    applyPreset(e.target.value);
  });
}

function applyPreset(preset) {
  state.preset = preset;
  const now = new Date();
  switch (preset) {
    case 'thisMonth':
      state.startDate = monthStart(now);
      state.endDate   = monthEnd(now);
      break;
    case 'prevMonth': {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      state.startDate = monthStart(prev);
      state.endDate   = monthEnd(prev);
      break;
    }
    case 'last7': {
      const from = new Date(now); from.setDate(from.getDate() - 6);
      state.startDate = isoDate(from);
      state.endDate   = isoDate(now);
      break;
    }
    case 'last30': {
      const from = new Date(now); from.setDate(from.getDate() - 29);
      state.startDate = isoDate(from);
      state.endDate   = isoDate(now);
      break;
    }
    case 'ytd':
      state.startDate = `${now.getFullYear()}-01-01`;
      state.endDate   = isoDate(now);
      break;
    case 'custom':
      return; // no changes
  }
  document.getElementById('filterStart').value = state.startDate;
  document.getElementById('filterEnd').value   = state.endDate;
  loadReport();
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadReport() {
  if (state.startDate > state.endDate) {
    setStatus('Начальная дата не может быть позже конечной', true);
    return;
  }

  const mySeq = ++loadSeq;
  const isStale = () => mySeq !== loadSeq;

  setBtnDisabled(true);
  const months = monthsInRange(state.startDate, state.endDate);
  const toLoad = months.filter(m => !state.monthsCache.has(m));

  const failed = [];
  try {
    // Sequential to avoid overwhelming the Bitrix24 queue (parallel calls trigger QUEUE_TIMEOUT)
    for (let i = 0; i < toLoad.length; i++) {
      if (isStale()) return; // user changed the range — abandon this run
      const period = toLoad[i];
      setStatus(`Загрузка ${i + 1} из ${toLoad.length}: ${humanPeriod(period)}…`);
      try {
        await loadMonthIntoCache(period);
      } catch (err) {
        failed.push({ period, error: err.message });
      }
    }

    if (isStale()) return;

    if (!toLoad.length) setStatus('Загрузка данных…');

    state.data = mergeAndFilter(state.monthsCache, months, state.startDate, state.endDate);
    const base = `Период ${formatDateRu(state.startDate)} — ${formatDateRu(state.endDate)} · обновлено ${new Date().toLocaleString('ru-RU')}`;
    if (failed.length) {
      setStatus(`${base} · не удалось загрузить: ${failed.map(f => humanPeriod(f.period)).join(', ')}`, true);
    } else {
      setStatus(base);
    }
    renderAll();
  } catch (err) {
    if (!isStale()) setStatus('Ошибка: ' + err.message, true);
  } finally {
    if (!isStale()) setBtnDisabled(false);
  }
}

function humanPeriod(period) {
  const [y, m] = period.split('-');
  return `${MONTHS[parseInt(m, 10)]} ${y}`;
}

async function loadMonthIntoCache(period, { attempts = 3 } = {}) {
  if (state.monthsCache.has(period)) return;
  if (state.pendingMonths.has(period)) return state.pendingMonths.get(period);

  const promise = (async () => {
    const [year, month] = period.split('-').map(Number);
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`/api/report?year=${year}&month=${month}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        state.monthsCache.set(period, await res.json());
        return;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          await new Promise(r => setTimeout(r, 1500 * (i + 1))); // 1.5s, 3s
        }
      }
    }
    throw lastErr;
  })().finally(() => state.pendingMonths.delete(period));

  state.pendingMonths.set(period, promise);
  return promise;
}

// Returns the 12 most recent calendar months, oldest first (YYYY-MM).
function trendMonthList() {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  return months;
}

// Fetch any of the last 12 months that aren't cached yet. Sequential (gentle
// on Bitrix24 rate limits), re-rendering charts as each month completes.
async function loadTrendInBackground() {
  const months = trendMonthList();
  const missing = months.filter(p => !state.monthsCache.has(p));
  if (!missing.length) { renderCharts(); return; }

  state.trendLoading = true;
  renderCharts();

  for (let i = 0; i < missing.length; i++) {
    try {
      await loadMonthIntoCache(missing[i]);
    } catch {
      // Keep going; chart simply skips that month.
    }
    renderCharts();
  }

  state.trendLoading = false;
  renderCharts();
}

async function onRefreshQuick() {
  setBtnDisabled(true);
  resetBannerForNewScan();
  try {
    const res = await fetch('/api/report/refresh-incremental?days=2', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus('Обновление последних данных запущено…');
  } catch (err) {
    setStatus('Ошибка запуска обновления: ' + err.message, true);
    setBtnDisabled(false);
  }
}

async function onRefreshFull() {
  const ok = confirm(
    'Запустить полный пересчёт всех данных?\n\n' +
    'Это займёт ~40 минут — все задачи на портале будут перечитаны заново.\n' +
    'Используй только если данные сильно расходятся с реальностью.'
  );
  if (!ok) return;

  setBtnDisabled(true);
  resetBannerForNewScan();
  try {
    const res = await fetch('/api/report/refresh', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus('Полный скан запущен — ~40 минут, прогресс в баннере…');
  } catch (err) {
    setStatus('Ошибка запуска скана: ' + err.message, true);
    setBtnDisabled(false);
  }
}

// Combine monthly data into a single view filtered to [startDate, endDate].
// Grade/salary recomputed from filtered entries using the monthly formula.
function mergeAndFilter(cache, months, startDate, endDate) {
  const byEmp = new Map();

  for (const period of months) {
    const monthData = cache.get(period);
    if (!monthData?.employees) continue;

    for (const emp of monthData.employees) {
      if (!byEmp.has(emp.id)) {
        byEmp.set(emp.id, { id: emp.id, name: emp.name, entries: [] });
      }
      const merged = byEmp.get(emp.id);
      for (const entry of emp.entries) {
        if (entry.date >= startDate && entry.date <= endDate) {
          merged.entries.push(entry);
        }
      }
    }
  }

  const employees = [];
  for (const emp of byEmp.values()) {
    if (!emp.entries.length) continue;

    emp.entries.sort((a, b) => a.date.localeCompare(b.date));

    const rawTotalMinutes     = emp.entries.reduce((s, e) => s + e.minutes, 0);
    const totalMinutes        = emp.entries.reduce((s, e) => s + effectiveMinutes(e), 0);
    const motivationalMinutes = emp.entries.filter(e => !isNonMotivational(e)).reduce((s, e) => s + effectiveMinutes(e), 0);
    const asteriskMinutes     = totalMinutes - motivationalMinutes;

    const totalHours        = Math.floor(totalMinutes        / 60);
    const motivationalHours = Math.floor(motivationalMinutes / 60);
    const asteriskHours     = Math.floor(asteriskMinutes     / 60);

    const grade     = calcGrade(motivationalHours);
    const nextGrade = calcNextGrade(motivationalHours);
    const salary    = 40000 + Math.round(totalMinutes * 1000 / 60) + grade.bonus;

    employees.push({
      ...emp,
      rawTotalMinutes,
      totalMinutes, totalHours,
      motivationalMinutes, motivationalHours,
      asteriskMinutes, asteriskHours,
      grade:                grade.hours,
      gradeBonus:           grade.bonus,
      salary,
      remainingToNextGrade: nextGrade ? nextGrade.hours - motivationalHours : 0,
    });
  }

  employees.sort((a, b) => b.totalHours - a.totalHours);

  // Per-month trend (for charts) based on entries inside the range
  const monthTrend = months.map(period => {
    const monthStartD = `${period}-01`;
    const [y, m] = period.split('-').map(Number);
    const monthEndD = `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const s = maxDate(monthStartD, startDate);
    const e = minDate(monthEndD, endDate);
    let totalMinutes = 0, totalSalary = 0;
    for (const emp of employees) {
      const msPerEmp = emp.entries
        .filter(en => en.date >= s && en.date <= e)
        .reduce((sum, en) => sum + effectiveMinutes(en), 0);
      totalMinutes += msPerEmp;
      // salary share for this sub-period (approximate): totalMinutes_of_emp_for_range * 1000 / 60 ... tricky.
      // simpler: skip per-month salary for partial ranges; show total hours only
    }
    // For salary trend: use the month's cached summary (full month) if the entire month is within range
    const monthData = cache.get(period);
    const wholeMonthInRange = monthStartD >= startDate && monthEndD <= endDate;
    if (wholeMonthInRange && monthData?.summary) totalSalary = monthData.summary.totalSalary;

    return {
      period,
      totalHours: Math.floor(totalMinutes / 60),
      totalSalary,
      partial: !wholeMonthInRange,
    };
  });

  return {
    startDate,
    endDate,
    employees,
    monthTrend,
  };
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function filteredEmployees() {
  if (!state.data) return [];
  return state.data.employees.filter(emp => emp.entries.length > 0);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  renderTable();
  renderCharts();
}

function renderTable() {
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const employees = filteredEmployees();
  const days = buildDayList(state.startDate, state.endDate);

  renderHead(thead, days);

  if (!employees.length) {
    const colCount = 4 + days.length;
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;padding:24px;color:var(--text-muted)">Нет данных</td></tr>`;
    return;
  }

  for (const emp of employees) {
    tbody.appendChild(buildEmployeeRow(emp, days));
  }

  tbody.appendChild(buildTotalRow(employees, days));
}

function buildDayList(startDate, endDate) {
  const days = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  let cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (cur <= end) {
    days.push({
      day:       cur.getDate(),
      month:     cur.getMonth() + 1,
      year:      cur.getFullYear(),
      dow:       DOW[cur.getDay()],
      isWeekend: cur.getDay() === 0 || cur.getDay() === 6,
      iso:       isoDate(cur),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function renderHead(thead, days) {
  const tr1 = document.createElement('tr');
  tr1.innerHTML = `
    <th rowspan="2" class="col-employee">Сотрудник</th>
    <th colspan="5" class="th-group">Итоги</th>
    ${days.map(d => `
      <th rowspan="2" class="th-day ${d.isWeekend ? 'weekend' : ''}">
        <span class="day-num">${pad(d.day)}</span><span class="day-dow">${d.dow}</span>
        <span class="day-month">${MONTHS_SHORT[d.month]} ${d.year}</span>
      </th>
    `).join('')}
  `;

  const tr2 = document.createElement('tr');
  tr2.innerHTML = `
    <th title="Общее итого списано (без учёта правил)">Итого</th>
    <th title="Списано с учётом внутренних часов ×0.5">×½ внутр.</th>
    <th title="Списано с учётом внутренних ×0.5 и без задач ✴️">Без ✴️</th>
    <th>До след.</th>
    <th>Зарплата</th>
  `;

  thead.appendChild(tr1);
  thead.appendChild(tr2);
}

function buildEmployeeRow(emp, days) {
  const byDate = groupEntriesByDate(emp.entries);
  const motivationalHours = emp.motivationalHours ?? emp.totalHours;
  const color  = gradeColor(motivationalHours);

  const tr = document.createElement('tr');
  tr.dataset.empId   = emp.id;
  tr.dataset.empName = emp.name;

  const cells = days.map(d => {
    const mins = byDate.get(d.iso) || 0;
    return renderDayCell(mins, d, emp.name, emp.id);
  }).join('');

  // Remaining hours+minutes to the next grade threshold
  let remainingCell;
  if (emp.grade === 140) {
    remainingCell = '<span class="remaining-max">Макс.</span>';
  } else {
    const nextThreshold   = emp.grade === 0 ? 60 : emp.grade + 10;
    const remainingMin    = Math.max(0, nextThreshold * 60 - emp.motivationalMinutes);
    const remH            = Math.floor(remainingMin / 60);
    const remM            = remainingMin % 60;
    const remainingText   = remM === 0 ? `${remH}ч` : `${remH}ч ${remM}м`;
    const pct             = Math.min(100, Math.round((emp.motivationalMinutes / (nextThreshold * 60)) * 100));
    remainingCell = `
      <div class="remaining-wrap">
        <div class="remaining-text">${remainingText} до ${nextThreshold}ч</div>
        <div class="progress-bar"><div class="progress-fill ${color}" style="width:${pct}%"></div></div>
      </div>`;
  }

  tr.innerHTML = `
    <td class="col-employee">${userLink(emp.id, emp.name)}</td>
    <td class="col-total">${formatHours(emp.rawTotalMinutes ?? emp.totalMinutes)}</td>
    <td class="col-total">${formatHours(emp.totalMinutes)}</td>
    <td class="col-total">${formatHours(emp.motivationalMinutes)}</td>
    <td class="col-remaining">${remainingCell}</td>
    <td class="col-total-salary">${emp.salary.toLocaleString('ru-RU')} ₽</td>
    ${cells}
  `;

  return tr;
}

function buildTotalRow(employees, days) {
  const totalByDate = new Map();
  let rawTotalMinutes   = 0;
  let totalMinutes      = 0;
  let motivMinutes      = 0;
  let totalSalary       = 0;

  for (const emp of employees) {
    rawTotalMinutes += emp.rawTotalMinutes ?? emp.totalMinutes;
    totalMinutes    += emp.totalMinutes;
    motivMinutes    += emp.motivationalMinutes;
    totalSalary     += emp.salary;
    for (const entry of emp.entries) {
      totalByDate.set(entry.date, (totalByDate.get(entry.date) || 0) + entry.minutes);
    }
  }

  const cells = days.map(d => {
    const mins = totalByDate.get(d.iso) || 0;
    return renderDayCell(mins, d, 'ВСЕГО');
  }).join('');

  const tr = document.createElement('tr');
  tr.className = 'row-total';
  tr.innerHTML = `
    <td class="col-employee">ВСЕГО</td>
    <td>${formatHours(rawTotalMinutes)}</td>
    <td>${formatHours(totalMinutes)}</td>
    <td>${formatHours(motivMinutes)}</td>
    <td>—</td>
    <td>${totalSalary.toLocaleString('ru-RU')} ₽</td>
    ${cells}
  `;
  return tr;
}

function groupEntriesByDate(entries) {
  const map = new Map();
  for (const e of entries) {
    map.set(e.date, (map.get(e.date) || 0) + e.minutes);
  }
  return map;
}

function renderDayCell(mins, day, empName, empId = '') {
  if (!mins) {
    return `<td class="day-cell empty ${day.isWeekend ? 'weekend' : ''}">—</td>`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hLabel = h === 0 ? `${m}м` : (m === 0 ? `${h}ч` : `${h}ч ${m}м`);
  const tooltip = `${empName}|${formatDateRu(day.iso)}|Списано времени - ${formatHours(mins)}`;
  return `<td class="day-cell ${day.isWeekend ? 'weekend' : ''}"
            data-tip="${esc(tooltip)}"
            data-date="${day.iso}"
            data-dow="${day.dow}"
            data-emp-id="${esc(empId)}"
            data-emp-name="${esc(empName)}"
            role="button"
            tabindex="0">${hLabel}</td>`;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function bindTooltip() {
  const tip = document.getElementById('cellTooltip');
  document.addEventListener('mouseover', e => {
    const cell = e.target.closest('[data-tip]');
    if (!cell) return;
    const [name, date, hours] = cell.dataset.tip.split('|');
    tip.innerHTML = `<strong>${esc(name)}</strong> ${esc(date)}\n${esc(hours)}`;
    tip.classList.add('visible');
  });
  document.addEventListener('mousemove', e => {
    if (!tip.classList.contains('visible')) return;
    const x = e.pageX + 14;
    const y = e.pageY + 14;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  });
  document.addEventListener('mouseout', e => {
    if (!e.target.closest('[data-tip]')) return;
    tip.classList.remove('visible');
  });
}

// ─── Slideover (day details) ──────────────────────────────────────────────────

function bindSlideover() {
  document.getElementById('slideoverClose').addEventListener('click', closeSlideover);
  document.getElementById('slideoverBackdrop').addEventListener('click', closeSlideover);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSlideover(); });

  document.addEventListener('click', e => {
    const cell = e.target.closest('.day-cell[data-date]');
    if (!cell || cell.classList.contains('empty')) return;
    openSlideover({
      date:    cell.dataset.date,
      dow:     cell.dataset.dow,
      empId:   cell.dataset.empId,
      empName: cell.dataset.empName,
    });
  });
}

function openSlideover({ date, dow, empId, empName }) {
  const title = document.getElementById('slideoverTitle');
  const body  = document.getElementById('slideoverBody');
  const isTotalRow = !empId;

  const heading = isTotalRow
    ? `Списанное время за ${formatDateRu(date)} (${dow})`
    : `Списанное время ${empName} ${formatDateRu(date)} (${dow})`;
  title.textContent = heading;

  const rows = collectEntries(date, empId).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  body.innerHTML = rows.length
    ? rows.map(renderDetailRow).join('')
    : `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">Нет записей</td></tr>`;

  document.getElementById('slideover').classList.add('visible');
  document.getElementById('slideoverBackdrop').classList.add('visible');
}

function closeSlideover() {
  document.getElementById('slideover').classList.remove('visible');
  document.getElementById('slideoverBackdrop').classList.remove('visible');
}

function collectEntries(date, empId) {
  const employees = filteredEmployees();
  const list = [];
  for (const emp of employees) {
    if (empId && emp.id !== empId) continue;
    for (const e of emp.entries) {
      if (e.date === date) list.push({ ...e, empName: emp.name, empId: emp.id });
    }
  }
  return list;
}

function renderDetailRow(e) {
  const commentDate = e.createdAt ? formatDateRu(e.createdAt.split('T')[0]) : formatDateRu(e.date);
  const rowClass    = isNonMotivational(e) ? 'row-asterisk' : '';
  const asteriskTag = isNonMotivational(e) ? ' <span class="asterisk-tag" title="Почасовая задача (✴️ в названии): не учитывается в грейде, оплата 1000₽/ч">✴️</span>' : '';
  const halfTag     = isHalfRate(e)        ? ' <span class="asterisk-tag" title="Внутренние задачи Фоменко: учитывается половина времени">×0.5</span>' : '';
  return `
    <tr class="${rowClass}">
      <td>${taskLink(e, 'task-link')}</td>
      <td>${userLink(e.empId, e.empName)}</td>
      <td class="time-cell">${formatHours(e.minutes)}${asteriskTag}${halfTag}</td>
      <td>${commentDate}</td>
      <td class="comment-cell">${esc(e.comment) || '—'}</td>
    </tr>
  `;
}

// ─── Link builders ────────────────────────────────────────────────────────────
// Build real anchor tags pointing at the Bitrix24 portal. When the BX24 SDK is
// available (running inside a registered Bitrix24 iframe app), clicks are
// intercepted by a global handler and routed through BX24.openLink.

function userLink(userId, label) {
  const path = `/company/personal/user/${userId}/`;
  const href = state.portalUrl + path;
  return `<a class="link" href="${href}" target="_blank" rel="noopener" data-b24-path="${path}">${esc(label)}</a>`;
}

function taskLink(entry, className = 'link') {
  // Prefer workgroup URL for group tasks (most reliable in modern Bitrix24);
  // fall back to responsible user, then task creator, then "0" wildcard.
  const gid  = entry.groupId;
  const rid  = entry.taskResponsibleId;
  const cid  = entry.taskCreatedBy;
  let path;
  if (gid && gid !== '0') {
    path = `/workgroups/group/${gid}/tasks/task/view/${entry.taskId}/`;
  } else if (rid) {
    path = `/company/personal/user/${rid}/tasks/task/view/${entry.taskId}/`;
  } else if (cid) {
    path = `/company/personal/user/${cid}/tasks/task/view/${entry.taskId}/`;
  } else {
    path = `/company/personal/user/0/tasks/task/view/${entry.taskId}/`;
  }
  const href = state.portalUrl + path;
  return `<a class="${className}" href="${href}" target="_blank" rel="noopener" data-b24-path="${path}">${esc(entry.taskName)}</a>`;
}

// ─── Charts ───────────────────────────────────────────────────────────────────

// One combined chart with two lines (часы + зарплата) on separate Y axes.
// Always shows the trailing 12 months; missing months render as gaps.
function renderCharts() {
  const months = trendMonthList();

  const labels = months.map(period => {
    const [y, m] = period.split('-');
    return `${MONTHS_SHORT[parseInt(m, 10)]} ${y.slice(2)}`;
  });

  const hoursData  = months.map(period => {
    const emp = state.monthsCache.get(period)?.employees?.[0];
    return emp ? emp.totalHours : null;
  });
  const salaryData = months.map(period => {
    const emp = state.monthsCache.get(period)?.employees?.[0];
    return emp ? emp.salary : null;
  });

  if (chartTrend) chartTrend.destroy();
  chartTrend = new Chart(document.getElementById('chartTrend'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Часы',
          data: hoursData,
          borderColor: '#4a9eff',
          backgroundColor: '#4a9eff22',
          borderWidth: 2,
          pointBackgroundColor: '#4a9eff',
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          fill: false,
          spanGaps: false,
          yAxisID: 'yHours',
        },
        {
          label: 'Зарплата, ₽',
          data: salaryData,
          borderColor: '#22c55e',
          backgroundColor: '#22c55e22',
          borderWidth: 2,
          pointBackgroundColor: '#22c55e',
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          fill: false,
          spanGaps: false,
          yAxisID: 'ySalary',
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: '#d5deef', usePointStyle: true, padding: 16 },
        },
        tooltip: {
          backgroundColor: '#16203a',
          titleColor: '#fff',
          bodyColor: '#d5deef',
          borderColor: '#2a3a5e',
          borderWidth: 1,
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (v == null) return `${ctx.dataset.label}: —`;
              if (ctx.dataset.yAxisID === 'ySalary') {
                return `${ctx.dataset.label}: ${v.toLocaleString('ru-RU')} ₽`;
              }
              return `${ctx.dataset.label}: ${v} ч`;
            },
          },
        },
      },
      scales: {
        yHours: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          grid:   { color: '#223153' },
          ticks:  { color: '#4a9eff', callback: v => `${v} ч` },
          title:  { display: true, text: 'Часы', color: '#4a9eff' },
        },
        ySalary: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          grid:   { display: false },
          ticks:  { color: '#22c55e', callback: v => `${(v/1000).toFixed(0)}к ₽` },
          title:  { display: true, text: 'Зарплата', color: '#22c55e' },
        },
        x: { grid: { display: false }, ticks: { color: '#7b8aae' } },
      },
    },
  });

  updateChartTitle();
}

function updateChartTitle() {
  const title = document.querySelector('#chartTrend')?.closest('.chart-wrap')?.querySelector('.chart-title');
  if (!title) return;
  const missing = trendMonthList().filter(p => !state.monthsCache.has(p)).length;
  title.textContent = state.trendLoading && missing
    ? `Часы и зарплата по месяцам — загрузка (${12 - missing} из 12)…`
    : `Часы и зарплата по месяцам — последние 12 месяцев`;
}

// ─── Grade / salary helpers (frontend duplicate of backend rules) ────────────

function calcGrade(hours) {
  return GRADES.find(g => hours >= g.hours) ?? GRADES[GRADES.length - 1];
}

function calcNextGrade(hours) {
  const ascending = [...GRADES].reverse();
  return ascending.find(g => g.hours > hours) ?? null;
}

function gradeColor(hours) {
  if (hours >= 140) return 'gold';
  if (hours >= 100) return 'green';
  if (hours >= 60)  return 'blue';
  return 'none';
}

// ✴ in the TASK TITLE marks hourly-only work (not counted toward grade).
function isNonMotivational(e) { return /✴/.test(e.taskName || ''); }

// "ВНУТРЕННИЕ: Фоменко" tasks are counted at half rate.
const HALF_RATE_TASK = /^\s*внутренние\s*:\s*фоменко\s*$/i;
function isHalfRate(e)        { return HALF_RATE_TASK.test(e.taskName || ''); }
function effectiveMinutes(e)  { return isHalfRate(e) ? Math.round(e.minutes / 2) : e.minutes; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}ч ${pad(m)}м` : `${h}ч`;
}

function formatDateRu(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

function monthStart(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; }
function monthEnd(d = new Date())   {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return isoDate(last);
}

function monthsInRange(start, end) {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const months = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${pad(m)}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

function maxDate(a, b) { return a > b ? a : b; }
function minDate(a, b) { return a < b ? a : b; }

function plural(n, one, few, many) {
  const mod10  = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

function setBtnDisabled(val) {
  const q = document.getElementById('btnRefreshQuick');
  const f = document.getElementById('btnRefreshFull');
  if (q) q.disabled = val;
  if (f) f.disabled = val;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pad(n) { return String(n).padStart(2, '0'); }

// ─── Start ────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
