// Синтетические данные для демо-дашборда контроля качества звонков.
// Структура совпадает с боевой: api/overview, api/dashboard, api/secretary, api/hub-call.
// Реальная версия читает Google Sheets с разметкой ОКК.

window.DEMO_DATA = (() => {
  // ── Менеджеры (нейтральные B2B-имена) ──────────────────────────────
  const MANAGERS = [
    'Соколов А.', 'Лебедев Д.', 'Гончарова Е.', 'Морозова Т.',
    'Зайцева М.', 'Орлов К.', 'Никитин П.',
  ];

  const TYPES = ['Холодный', 'Тёплый', 'Входящий', 'Контактный хаб', 'Секретарь'];

  const CRITERIA = [
    'Приветствие', 'Идентификация ЛПР', 'Презентация ценности',
    'Отработка возражений', 'Закрытие на следующий шаг', 'Прощание', 'CRM: фиксация сделки',
  ];

  const OBJECTIONS = [
    'У нас уже есть подрядчик',
    'Дорого / нет бюджета',
    'Перезвоните позже',
    'Отправьте на email',
    'Не интересно',
    'Подумаем',
  ];

  // ── Недели: 8 последних ISO-недель до 20 апреля 2026 ────────────────
  const ANCHOR = new Date('2026-04-20'); // понедельник недели #17
  const WEEKS = [];
  for (let i = 7; i >= 0; i--) {
    const monday = new Date(ANCHOR);
    monday.setDate(monday.getDate() - i * 7);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    // ISO week
    const tmp = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    const key = `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    WEEKS.push({
      key,
      label: `${weekNum} неделя`,
      weekNum,
      weekStart: monday.toISOString().slice(0, 10),
      weekEnd: sunday.toISOString().slice(0, 10),
    });
  }

  // ── Детерминированный псевдо-ранд (чтобы при каждом открытии — стабильно) ──
  let _seed = 1234567;
  function rng() { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; }
  function rint(min, max) { return Math.floor(min + rng() * (max - min + 1)); }

  // Базовый "уровень" каждого менеджера, влияющий на качество
  const MGR_BASE = {};
  MANAGERS.forEach((m, i) => {
    // 60..92 средний % ОКК у каждого, варьируется по неделям ±5%
    MGR_BASE[m] = { okk: 60 + (i * 5) + rint(-3, 8), crm: 55 + (i * 4) + rint(-3, 10) };
  });

  // ── Генерация: byWeekManager, byWeekType, byWeekCriterion, byWeekTotal ──
  const byWeekManager = {};
  const byWeekType = {};
  const byWeekCriterion = {};
  const byWeekTotal = {};

  for (const m of MANAGERS) {
    byWeekManager[m] = {};
    for (const w of WEEKS) {
      const okk = Math.max(40, Math.min(98, MGR_BASE[m].okk + rint(-7, 7)));
      const crm = Math.max(35, Math.min(98, MGR_BASE[m].crm + rint(-8, 8)));
      const count = rint(8, 28);
      byWeekManager[m][w.key] = { pctCall: okk, pctCrm: crm, minutes: count * rint(3, 7), count };
    }
  }
  for (const t of TYPES) {
    byWeekType[t] = {};
    for (const w of WEEKS) {
      byWeekType[t][w.key] = { pctCall: rint(55, 92), pctCrm: rint(50, 90), minutes: rint(20, 200), count: rint(5, 30) };
    }
  }
  for (const c of CRITERIA) {
    byWeekCriterion[c] = {};
    for (const w of WEEKS) {
      // Критерии — некоторые слабые: «CRM: фиксация сделки», «Закрытие на следующий шаг»
      const base = c.includes('CRM') ? 45 : c.includes('Закрытие') ? 55 : c.includes('возражений') ? 65 : 80;
      byWeekCriterion[c][w.key] = Math.max(20, Math.min(100, base + rint(-15, 15)));
    }
  }
  for (const w of WEEKS) {
    // Усреднение по менеджерам
    let okkSum = 0, crmSum = 0, mins = 0, cnt = 0;
    for (const m of MANAGERS) {
      const cell = byWeekManager[m][w.key];
      okkSum += cell.pctCall * cell.count;
      crmSum += cell.pctCrm * cell.count;
      mins += cell.minutes;
      cnt += cell.count;
    }
    byWeekTotal[w.key] = {
      pctCall: cnt ? Math.round(okkSum / cnt) : null,
      pctCrm: cnt ? Math.round(crmSum / cnt) : null,
      minutes: mins,
      count: cnt,
    };
  }

  // ── overview / summary ─────────────────────────────────────────────
  let totalCalls = 0, sumOkk = 0, sumCrm = 0, totalMinutes = 0;
  for (const w of WEEKS) {
    const t = byWeekTotal[w.key];
    totalCalls += t.count;
    sumOkk += (t.pctCall || 0) * t.count;
    sumCrm += (t.pctCrm || 0) * t.count;
    totalMinutes += t.minutes;
  }
  const summary = {
    totalCalls,
    pctCallAvg: totalCalls ? sumOkk / totalCalls : null,
    pctCrmAvg: totalCalls ? sumCrm / totalCalls : null,
    totalMinutes,
  };

  // ── Звонки «Секретарь» — детализация ───────────────────────────────
  const secCalls = [];
  for (let i = 0; i < 18; i++) {
    const day = rint(0, 27);
    const date = new Date(ANCHOR);
    date.setDate(date.getDate() - day);
    const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
    const mgr = MANAGERS[rint(0, MANAGERS.length - 1)];
    const obj = OBJECTIONS[rint(0, OBJECTIONS.length - 1)];
    const pctCall = rint(40, 95);
    const pctObj = rint(20, 95);
    const pctCrm = rint(40, 95);
    secCalls.push({
      date: dateStr,
      time: `${String(rint(9, 18)).padStart(2, '0')}:${String(rint(0, 59)).padStart(2, '0')}`,
      manager: mgr,
      direction: rng() < 0.7 ? 'Исходящий' : 'Входящий',
      duration: rint(45, 600),
      view: rng() < 0.5 ? 'ЛПР' : 'Не ЛПР',
      objection: obj,
      objCriteria: [rint(0, 1), rint(0, 1), rint(0, 1)],
      pctCall, pctObj, pctCrm,
      score: rng() < 0.5 ? 'Хорошо' : 'Средне',
      auditor: 'Аудитор Q',
      comment: rng() < 0.4 ? 'Слабо отработано возражение, нет чёткого следующего шага.' : 'Хорошо удержал диалог, передал на следующий этап.',
      criteria: Object.fromEntries(CRITERIA.map(c => [c, rint(0, 1)])),
      crmChecklist: {},
      recordLink: '#',
      dealLink: '#',
    });
  }
  secCalls.sort((a, b) => b.date.localeCompare(a.date));

  const byObjection = {};
  const byMgrSec = {};
  for (const c of secCalls) {
    byObjection[c.objection] = (byObjection[c.objection] || 0) + 1;
    if (!byMgrSec[c.manager]) byMgrSec[c.manager] = { count: 0, sumPctObj: 0 };
    byMgrSec[c.manager].count += 1;
    byMgrSec[c.manager].sumPctObj += c.pctObj;
  }
  const secByManager = Object.entries(byMgrSec)
    .map(([manager, v]) => ({ manager, count: v.count, pctObj: Math.round(v.sumPctObj / v.count) }))
    .sort((a, b) => b.count - a.count);
  const secByObjection = Object.entries(byObjection)
    .map(([objection, count]) => ({ objection, count }))
    .sort((a, b) => b.count - a.count);

  // ── Прозвон «Контактный хаб» 08:50–10:10 ───────────────────────────
  const hubByManager = MANAGERS.map(m => ({
    manager: m,
    count: rint(2, 12),
    pctCall: rint(60, 92),
  })).sort((a, b) => a.manager.localeCompare(b.manager, 'ru'));
  const hubTotal = hubByManager.reduce((s, x) => s + x.count, 0);

  // ── Диапазон дат (для overview) ────────────────────────────────────
  const dateRange = {
    from: WEEKS[0].weekStart,
    to: WEEKS[WEEKS.length - 1].weekEnd,
  };

  return {
    sheetName: 'Звонки ОКК',
    totalAll: totalCalls,
    managers: MANAGERS,
    types: TYPES,
    criteria: CRITERIA,
    weeksList: WEEKS,
    weeks: WEEKS,
    dateRange,
    summary,
    byWeekManager, byWeekType, byWeekCriterion, byWeekTotal,
    secCalls, secByManager, secByObjection,
    hubByManager, hubTotal,
  };
})();
