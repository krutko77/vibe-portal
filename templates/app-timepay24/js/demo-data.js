// Синтетика для демо «Часы за зарплату».
// Структура совпадает с боевым /api/report?year=YYYY&month=MM —
// поле employees[] с entries[] (минуты × дни × задачи).
// Сетка грейдов: 60→10к, 70→20к, ... 140→90к (как в боевом приложении).
//
// Месяцы заполняются на лету: для каждого (year, month) генерируется
// детерминированный набор сотрудников с их дневной активностью.

(() => {
  const EMPLOYEES = [
    { id: 'e1', name: 'Иванова А. М.', avgHours: 145, focus: 0.85, role: 'Senior' },   // переработка
    { id: 'e2', name: 'Петров К. С.',  avgHours: 128, focus: 0.78, role: 'Middle' },
    { id: 'e3', name: 'Соколов Д. В.', avgHours: 116, focus: 0.72, role: 'Middle' },
    { id: 'e4', name: 'Морозова Е. Н.', avgHours: 102, focus: 0.66, role: 'Junior' },
    { id: 'e5', name: 'Захаров Р. О.', avgHours: 88,  focus: 0.58, role: 'Junior' },
    { id: 'e6', name: 'Лебедев П. А.', avgHours: 64,  focus: 0.50, role: 'Junior' },   // недогруз
  ];

  const TASKS = [
    { id: 't101', name: 'ТД Магистраль · CRM-настройка воронки B2B' },
    { id: 't102', name: 'ТД Магистраль · интеграция с 1С (заказы)' },
    { id: 't103', name: 'Северное Сияние · карточка сделки + автоматизация' },
    { id: 't104', name: 'Северное Сияние · отчёт по менеджерам' },
    { id: 't105', name: 'ПромКомплект · импорт каталога 12 000 SKU' },
    { id: 't106', name: 'ПромКомплект · мобильное приложение склад' },
    { id: 't107', name: 'Альянс-Сервис · поддержка SLA 24/7' },
    { id: 't108', name: 'Альянс-Сервис · доработка отчётов руководителю' },
    { id: 't109', name: 'Гранит-Логистика · интеграция Wialon' },
    { id: 't110', name: 'Гранит-Логистика · дашборд автопарка' },
    { id: 't111', name: 'Восток-Аудит · портал клиента (документы)' },
    { id: 't112', name: 'Восток-Аудит · API синхронизации' },
    { id: 't113', name: 'ВНУТРЕННИЕ: Фоменко' },                              // half-rate
    { id: 't114', name: 'Митапы и обучение ✴' },                              // ✴ non-motivational
    { id: 't115', name: 'Релизный смоук-тест ✴' },
  ];

  // Простой детерминированный PRNG (xorshift32) — чтобы при перезагрузке
  // данные не мерцали.
  function rng(seed) {
    let s = seed >>> 0;
    if (s === 0) s = 0xDEADBEEF;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17; s >>>= 0;
      s ^= s << 5;  s >>>= 0;
      return (s >>> 0) / 0x100000000;
    };
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // Сезонный коэффициент: меньше часов в выходные, плюс «провал» по средам у некоторых.
  function workdayFactor(date, empSeed) {
    const dow = date.getDay(); // 0=вс
    if (dow === 0) return 0.05;
    if (dow === 6) return 0.18;
    return 1.0;
  }

  function buildMonthPayload(year, month) {
    const period = `${year}-${pad(month)}`;
    const dim = daysInMonth(year, month);
    const employees = [];

    for (const emp of EMPLOYEES) {
      const seed = parseInt(emp.id.slice(1)) * 1000 + year * 12 + month;
      const r = rng(seed);
      const targetMinutes = emp.avgHours * 60 * (0.85 + r() * 0.30);

      // Раскладываем по дням пропорционально workday factor.
      const dayFactors = [];
      let totalFactor = 0;
      for (let d = 1; d <= dim; d++) {
        const date = new Date(year, month - 1, d);
        const f = workdayFactor(date) * (0.6 + r() * 0.8);
        dayFactors.push({ d, f });
        totalFactor += f;
      }

      const entries = [];
      for (const { d, f } of dayFactors) {
        const dayMinutes = Math.round(targetMinutes * f / totalFactor);
        if (dayMinutes < 15) continue;

        // 1-3 задачи на день
        const taskCount = 1 + Math.floor(r() * 3);
        let remaining = dayMinutes;
        for (let i = 0; i < taskCount; i++) {
          const portion = i === taskCount - 1 ? remaining : Math.round(remaining * (0.4 + r() * 0.4));
          if (portion < 10) continue;
          remaining -= portion;
          // выбираем задачу с уклоном на focus — бо́льшая часть в "профильных"
          const taskIdx = r() < emp.focus
            ? Math.floor(r() * 12)            // основные клиентские
            : 12 + Math.floor(r() * 3);       // внутренние / non-motivational
          const task = TASKS[taskIdx];
          entries.push({
            id: `${period}-${emp.id}-${d}-${i}`,
            taskId: task.id,
            taskName: task.name,
            minutes: portion,
            date: `${period}-${pad(d)}`,
            createdAt: `${period}-${pad(d)}T18:00:00`,
            dateStart: `${period}-${pad(d)}`,
            comment: r() < 0.4
              ? ['Доработка по ТЗ', 'Созвон с клиентом', 'Тест на стейдже', 'Релиз в прод', 'Правки после демо', 'Разбор багов'][Math.floor(r() * 6)]
              : '',
            authorName: emp.name,
          });
          if (remaining <= 0) break;
        }
      }

      // Подсчёты, как в реальном бэке
      const isNonMotivational = (e) => /✴/.test(e.taskName || '');
      const HALF = /^\s*внутренние\s*:\s*фоменко\s*$/i;
      const isHalf = (e) => HALF.test(e.taskName || '');
      const eff = (e) => isHalf(e) ? Math.round(e.minutes / 2) : e.minutes;

      const rawTotalMinutes     = entries.reduce((s, e) => s + e.minutes, 0);
      const totalMinutes        = entries.reduce((s, e) => s + eff(e), 0);
      const motivationalMinutes = entries.filter(e => !isNonMotivational(e)).reduce((s, e) => s + eff(e), 0);
      const asteriskMinutes     = totalMinutes - motivationalMinutes;
      const totalHours          = Math.floor(totalMinutes / 60);
      const motivationalHours   = Math.floor(motivationalMinutes / 60);
      const asteriskHours       = Math.floor(asteriskMinutes / 60);

      const GRADES = [
        { hours: 140, bonus: 90000 }, { hours: 130, bonus: 80000 },
        { hours: 120, bonus: 70000 }, { hours: 110, bonus: 60000 },
        { hours: 100, bonus: 50000 }, { hours:  90, bonus: 40000 },
        { hours:  80, bonus: 30000 }, { hours:  70, bonus: 20000 },
        { hours:  60, bonus: 10000 }, { hours:   0, bonus:     0 },
      ];
      const grade = GRADES.find(g => motivationalHours >= g.hours) ?? GRADES[GRADES.length - 1];
      const nextGrade = [...GRADES].reverse().find(g => g.hours > motivationalHours) ?? null;
      const salary = 40000 + Math.round(totalMinutes * 1000 / 60) + grade.bonus;

      employees.push({
        id: emp.id,
        name: emp.name,
        rawTotalMinutes,
        totalMinutes, totalHours,
        motivationalMinutes, motivationalHours,
        asteriskMinutes, asteriskHours,
        grade: grade.hours,
        gradeBonus: grade.bonus,
        salary,
        remainingToNextGrade: nextGrade ? nextGrade.hours - motivationalHours : 0,
        entries,
      });
    }

    employees.sort((a, b) => b.totalHours - a.totalHours);

    const summary = {
      period,
      totalHours: employees.reduce((s, e) => s + e.totalHours, 0),
      totalSalary: employees.reduce((s, e) => s + e.salary, 0),
    };

    return {
      period,
      cachedAt: new Date().toISOString(),
      employees,
      history: [],
      summary,
    };
  }

  // Кэш по месяцу (стабильность данных при переключении).
  const cache = new Map();
  function getMonth(year, month) {
    const key = `${year}-${pad(month)}`;
    if (!cache.has(key)) cache.set(key, buildMonthPayload(year, month));
    return cache.get(key);
  }

  window.DEMO_DATA = {
    getMonth,
    config: {
      portalUrl: 'https://demo.bitrix24.ru',
    },
    status: {
      entriesStored: 24863,
      collectedAt: new Date().toISOString(),
      scan: { stage: 'idle', running: false },
    },
    EMPLOYEES,
    TASKS,
  };
})();
