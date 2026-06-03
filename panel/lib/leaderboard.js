// leaderboard.js — агрегаты активности учеников для публичного дашборда.
//
// ПРИВАТНОСТЬ. Дашборд видят ВСЕ залогиненные ученики, поэтому отсюда наружу
// уходят ТОЛЬКО числа-счётчики и имена учеников. Никакого текста сообщений,
// никаких названий чужих проектов — чтобы ничего не перетекало из одного
// проекта/ученика в другой. Источники:
//   - сообщения  → transcripts.dailyCounts() (только счётчики строк JSONL);
//   - заходы     → users-vibe.json (loginCount, см. students.recordLogin);
//   - проекты    → кол-во папок в workspace (без имён);
//   - публикации → кол-во проектов с publish.enabled (без имён).

import fs from 'node:fs';
import { loadUsers } from './auth.js';
import { workspaceDir } from './students.js';
import { dailyCounts } from './transcripts.js';
import { readPublish } from './publish.js';

// Веса очков (по запросу): заход = 20, созданное приложение = 100.
// Сообщения в общий балл НЕ входят (вес 0) — показываем их колонками.
// Менять веса здесь — единственный источник истины для формулы.
const WEIGHTS = { message: 0, login: 20, app: 100 };
const WEEK_DAYS = 7; // «за неделю» = последние 7 дней (включая сегодня)

// Технические/тестовые аккаунты — в рейтинг не показываем (помимо admin по роли).
const EXCLUDE = new Set(['test']);

// Дата в UTC YYYY-MM-DD — согласована с тем, как шим/транскрипты пишут day
// (new Date(ts).toISOString().slice(0,10)).
function utcDay(d) {
  return d.toISOString().slice(0, 10);
}

// Кол-во папок-проектов в workspace ученика (без имён). Скрытые (.deleted и т.п.)
// не считаем.
function countProjects(user) {
  const ws = workspaceDir(user);
  let dirs = [];
  try {
    dirs = fs.readdirSync(ws, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);
  } catch { return { created: 0, published: 0 }; }
  let published = 0;
  for (const d of dirs) {
    const p = readPublish(user, d);
    if (p && p.enabled) published++;
  }
  return { created: dirs.length, published };
}

// Полный рейтинг. Возвращает строки (отсортированы по очкам) + метаданные.
// Только агрегаты — безопасно отдавать любому залогиненному ученику.
export function leaderboard() {
  const now = new Date();
  const today = utcDay(now);
  const weekSet = new Set();
  for (let i = 0; i < WEEK_DAYS; i++) {
    weekSet.add(utcDay(new Date(now.getTime() - i * 86400000)));
  }

  const state = loadUsers();
  const rows = [];
  for (const [username, u] of Object.entries(state.users)) {
    if (u.role === 'admin') continue; // персонал в рейтинг не входит
    if (EXCLUDE.has(username)) continue; // тех./тестовые аккаунты

    const counts = dailyCounts(username);
    let msgToday = 0, msgWeek = 0, msgTotal = 0;
    for (const [day, n] of Object.entries(counts)) {
      msgTotal += n;
      if (day === today) msgToday += n;
      if (weekSet.has(day)) msgWeek += n;
    }

    const { created, published } = countProjects(username);
    const logins = u.loginCount || 0;
    const score = logins * WEIGHTS.login
      + created * WEIGHTS.app
      + msgTotal * WEIGHTS.message;

    rows.push({
      username, score, logins,
      created, published,
      msgToday, msgWeek, msgTotal,
      // Посуточные раскладки для дневного рейтинга (дашборд считает на клиенте).
      // Только числа-счётчики — приватность не страдает (как msgToday/msgWeek).
      dailyMsg: counts,
      dailyLogins: u.dailyLogins || {},
    });
  }

  rows.sort((a, b) =>
    b.score - a.score
    || b.msgWeek - a.msgWeek
    || a.username.localeCompare(b.username));
  rows.forEach((r, i) => { r.rank = i + 1; });

  // Самая ранняя дата с активностью — нижняя граница выбора дня в UI.
  let firstDate = today;
  for (const r of rows) {
    for (const d of Object.keys(r.dailyMsg)) if (d < firstDate) firstDate = d;
    for (const d of Object.keys(r.dailyLogins)) if (d < firstDate) firstDate = d;
  }

  return { rows, weights: WEIGHTS, weekDays: WEEK_DAYS, today, firstDate, count: rows.length };
}
