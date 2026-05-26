// Синтетика для демо «Штаб руководителя отдела». 4 вкладки данных
// (загрузка / проекты / акты / деньги) + замечания / благодарности / табель / часы / диалоги.
// Реальная версия читает Битрикс24 (CRM, SPA, задачи, чат-центр) и Google-таблицы.

window.DEMO_DATA = (() => {
  // ── PIN-логин обходим: помечаем сессию как авторизованную ───────────
  try { localStorage.setItem('shtab_auth_v1', 'authenticated_1425'); } catch {}

  let _seed = 7654321;
  const rng = () => { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; };
  const rint = (a, b) => Math.floor(a + rng() * (b - a + 1));

  // ── Сотрудники по двум отделам ─────────────────────────────────────
  // Tab 1 — отдел стандартных интеграций (7 человек)
  // Tab 2 — проектный отдел (2 человека)
  const TAB1_ANALYSTS = [
    { id: 101, name: 'А. Соколов', grade: 'Senior',  schedule: 'Пн–Пт 9–18' },
    { id: 102, name: 'Е. Гончарова', grade: 'Middle', schedule: 'Пн–Пт 9–18' },
    { id: 103, name: 'Д. Лебедев',  grade: 'Middle', schedule: 'Пн–Пт 10–19' },
    { id: 104, name: 'М. Зайцева',  grade: 'Junior', schedule: 'Пн–Пт 9–18' },
    { id: 105, name: 'К. Орлов',    grade: 'Junior', schedule: 'Пн–Чт 9–18' },
    { id: 106, name: 'П. Никитин',  grade: 'Senior', schedule: 'Пн–Пт 11–20' },
    { id: 107, name: 'Т. Морозова', grade: 'Middle', schedule: 'Пн–Пт 9–18' },
  ];
  const TAB2_ANALYSTS = [
    { id: 201, name: 'И. Степанов', grade: 'Senior', schedule: 'Пн–Пт 9–18' },
    { id: 202, name: 'О. Фомина',   grade: 'Middle', schedule: 'Пн–Пт 10–19' },
  ];
  const ALL_ANALYSTS = [
    ...TAB1_ANALYSTS.map(a => ({ ...a, dept: 'Стандартные интеграции' })),
    ...TAB2_ANALYSTS.map(a => ({ ...a, dept: 'Проектный отдел' })),
  ];

  // ── Клиенты (нейтральные B2B-имена) ────────────────────────────────
  const CLIENTS = [
    'ТД Магистраль', 'ПромКомплект', 'СеверноеСияние ООО', 'СтройРесурс',
    'АкваЛогистик', 'НеваГрупп', 'УралБетон', 'ВолгаТрейд',
    'СибирьМеталл', 'ДальневосточныйПорт', 'ЕвразияМаркет', 'КамаКемикал',
    'ОтделЭнерго', 'ТехноСтандарт', 'МаринЛогистика', 'АвтоПарк-77',
    'ГазСервис-Юг', 'ЭкоПродукт', 'РезервПлюс', 'ИнтерТекст-Принт',
  ];

  const PROJECT_TYPES = [
    'CRM-внедрение', 'Интеграция с 1С', 'Воронка по продажам',
    'Внедрение task tracker', 'Интеграция АТС', 'Настройка отчётов',
    'Миграция с AmoCRM', 'Чат-центр', 'Личный кабинет клиента',
  ];

  const STAGES = ['ТЗ', 'Ждем оплату', 'В настройке', 'Активные задачи', 'Мелкие задачи'];
  const PRIORITIES = ['💎 VIP-клиент', '⭐ Перспективный', '🏳️ Стандарт'];

  // ── Генератор проектов на сотрудника ───────────────────────────────
  function genProjects(analystId, count) {
    const projects = [];
    for (let i = 0; i < count; i++) {
      const c = CLIENTS[rint(0, CLIENTS.length - 1)];
      const t = PROJECT_TYPES[rint(0, PROJECT_TYPES.length - 1)];
      projects.push({
        id: analystId * 1000 + i,
        title: `${c} — ${t}`,
        stage: STAGES[rint(0, STAGES.length - 1)],
        priority: PRIORITIES[rint(0, PRIORITIES.length - 1)],
      });
    }
    return projects;
  }

  // ── /api/load?tab=1 ────────────────────────────────────────────────
  function buildLoad(deptAnalysts) {
    return {
      analysts: deptAnalysts.map(a => {
        const projCount = rint(3, 8);
        return {
          id: a.id,
          name: a.name,
          grade: a.grade,
          percent: rint(45, 135),
          photoUrl: null,
          foulsCount: rng() < 0.4 ? rint(1, 3) : 0,
          thanksCount: rng() < 0.5 ? rint(1, 4) : 0,
          projects: genProjects(a.id, projCount),
        };
      }),
    };
  }

  // ── /api/projects?tab=1 — канбан по сотрудникам ───────────────────
  function buildKanban(deptAnalysts) {
    return {
      columns: deptAnalysts.map(a => ({
        name: a.name,
        projects: genProjects(a.id, rint(2, 5))
          .map(p => ({ id: p.id, title: p.title, priority: p.priority })),
      })),
    };
  }

  // ── /api/money + /api/acts (бары: аналитики × ₽) ───────────────────
  function buildMoney(deptAnalysts) {
    const analysts = deptAnalysts.map(a => {
      const items = Array.from({ length: rint(2, 6) }, () => ({
        name: CLIENTS[rint(0, CLIENTS.length - 1)],
        amount: rint(20, 320) * 1000,
      }));
      const total = items.reduce((s, x) => s + x.amount, 0);
      return { id: a.id, name: a.name, total, items };
    });
    return { analysts, total: analysts.reduce((s, x) => s + x.total, 0) };
  }
  function buildActs(deptAnalysts) {
    const analysts = deptAnalysts.map(a => {
      const items = Array.from({ length: rint(1, 4) }, () => ({
        title: `Акт №${rint(1000, 9999)} — ${CLIENTS[rint(0, CLIENTS.length - 1)]}`,
        amount: rint(15, 280) * 1000,
      }));
      const total = items.reduce((s, x) => s + x.amount, 0);
      return { id: a.id, name: a.name, total, items };
    });
    return { analysts, total: analysts.reduce((s, x) => s + x.total, 0) };
  }

  // ── /api/stats — счётчики над графиками ────────────────────────────
  function buildStats(deptAnalysts) {
    const grades = {};
    deptAnalysts.forEach(a => { grades[a.grade] = (grades[a.grade] || 0) + 1; });
    return {
      grades,
      projectsInWork: rint(8, 22),
      projectsOnTP: rint(2, 7),
      projectsOnPause: rint(1, 4),
    };
  }

  // ── /api/monthly ───────────────────────────────────────────────────
  function buildMonthly(deptAnalysts) {
    const monthName = 'апреля 2026';
    const potentialItems = Array.from({ length: rint(4, 8) }, () => ({
      name: CLIENTS[rint(0, CLIENTS.length - 1)],
      stage: ['Согласование', 'Ждём оплату', 'Подписание акта'][rint(0, 2)],
      amount: rint(80, 450) * 1000,
    }));
    return {
      monthName,
      plan: 4_500_000,
      potential: potentialItems.reduce((s, x) => s + x.amount, 0),
      fact: rint(2200, 4800) * 1000,
      potentialItems,
    };
  }

  // ── /api/hours — проекты с остатком < 5ч ───────────────────────────
  function buildHours() {
    const items = Array.from({ length: rint(8, 14) }, () => {
      const h = rng() < 0.2 ? -rint(1, 4) : rint(0, 4);
      return {
        title: `${CLIENTS[rint(0, CLIENTS.length - 1)]} — ${PROJECT_TYPES[rint(0, PROJECT_TYPES.length - 1)]}`,
        url: '#',
        hours: h,
        hoursLabel: h < 0 ? `${h} ч` : `${h} ч`,
      };
    });
    return { items };
  }

  // ── /api/dialogs — чат-центр ───────────────────────────────────────
  function buildDialogs() {
    const formatAvg = (ms) => {
      if (!ms) return '—';
      const min = Math.round(ms / 60000);
      if (min < 1) return '< 1 мин';
      if (min < 60) return `${min} мин`;
      return `${Math.round(min / 60)} ч ${min % 60} мин`;
    };
    const analysts = TAB1_ANALYSTS.slice(0, 5).map(a => {
      const dialogCount = rint(0, 8);
      const dialogs = Array.from({ length: dialogCount }, (_, i) => {
        const ms = rint(2, 90) * 60000;
        return {
          title: `${CLIENTS[rint(0, CLIENTS.length - 1)]}: ${['Уточнения по интеграции', 'Доработка отчёта', 'Вопрос по доступам', 'Согласование ТЗ'][rint(0, 3)]}`,
          url: '#',
          avgMs: ms,
          avg: formatAvg(ms),
        };
      }).sort((x, y) => y.avgMs - x.avgMs);
      const sortedFast = [...dialogs].sort((x, y) => x.avgMs - y.avgMs);
      return {
        id: a.id,
        name: a.name,
        count: dialogs.length,
        best: sortedFast[0]?.title || null,
        worst: dialogs[0]?.title || null,
        dialogs,
      };
    });
    const total = analysts.reduce((s, a) => s + a.count, 0);
    return {
      total,
      analysts,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── /api/timesheet?month=YYYY-MM ───────────────────────────────────
  function buildTimesheet(ym) {
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const workDays = [];
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(y, m - 1, d);
      if (dt.getDay() === 0 || dt.getDay() === 6) continue;
      workDays.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    const marks = {};
    for (const a of ALL_ANALYSTS) {
      for (const d of workDays) {
        const r = rng();
        const v = r < 0.7 ? '8' : r < 0.85 ? String(rint(4, 7)) : r < 0.93 ? '' : r < 0.97 ? 'Б' : 'Н';
        if (v) marks[`${a.id}_${d}`] = v;
      }
    }
    return { analysts: ALL_ANALYSTS, workDays, marks };
  }

  // ── /api/fouls?from=&to= — недельная сетка замечаний ───────────────
  function buildFouls() {
    const monthlyChart = {};
    const monthlyFouls = {};
    const today = new Date();
    for (let mOff = 2; mOff >= 0; mOff--) {
      const dt = new Date(today.getFullYear(), today.getMonth() - mOff, 1);
      const mKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      monthlyChart[mKey] = {};
      for (const a of ALL_ANALYSTS) monthlyChart[mKey][String(a.id)] = rng() < 0.5 ? rint(0, 2) : 0;
    }
    for (const a of ALL_ANALYSTS) monthlyFouls[String(a.id)] = rng() < 0.4 ? rint(1, 3) : 0;

    // marks для недели (5 рабочих дней × сотрудники × колонки)
    const marks = {};
    const day = today.getDay() || 7;
    const mon = new Date(today);
    mon.setDate(today.getDate() - day + 1);
    for (let i = 0; i < 5; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const cols = i === 0 ? ['arrival', 'planning', 'standup', 'review'] : ['standup', 'review'];
      for (const a of ALL_ANALYSTS) {
        for (const col of cols) {
          const r = rng();
          if (r < 0.05) marks[`${dStr}_${a.id}_${col}`] = { value: '❌', comment: 'Опоздание на стендап' };
          else if (r < 0.85) marks[`${dStr}_${a.id}_${col}`] = { value: '✅' };
        }
      }
    }
    return { analysts: ALL_ANALYSTS, marks, monthlyFouls, monthlyChart };
  }

  // ── /api/thanks?month=YYYY-MM ──────────────────────────────────────
  function buildThanks(ym) {
    const totalThanks = {};
    const monthThanks = {};
    const marks = {};
    for (const a of ALL_ANALYSTS) {
      totalThanks[String(a.id)] = rint(0, 24);
      monthThanks[String(a.id)] = rint(0, 6);
      for (let w = 1; w <= 4; w++) {
        const c = rng() < 0.4 ? rint(1, 3) : 0;
        if (c) marks[`${a.id}_${w}`] = { count: c, from: CLIENTS[rint(0, CLIENTS.length - 1)] };
      }
    }
    return { analysts: ALL_ANALYSTS, marks, totalThanks, monthThanks, displayMonth: ym };
  }

  return {
    ALL_ANALYSTS, TAB1_ANALYSTS, TAB2_ANALYSTS,
    buildLoad, buildKanban, buildMoney, buildActs, buildStats, buildMonthly,
    buildHours, buildDialogs, buildTimesheet, buildFouls, buildThanks,
  };
})();
