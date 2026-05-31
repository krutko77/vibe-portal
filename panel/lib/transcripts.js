// transcripts.js — чтение аудит-логов диалогов ученик↔Claude (admin-only).
//
// Пишет их шим в TRANSCRIPTS_DIR/<user>/<YYYY-MM-DD>.jsonl (см. shim/transcript.js).
// Здесь — только чтение для admin-просмотра в панели.

import fs from 'node:fs';
import path from 'node:path';

const TRANSCRIPTS_DIR = process.env.TRANSCRIPTS_DIR || '/data/config/transcripts';
const USER_RE = /^[a-zA-Z0-9._-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Список учеников, у которых есть транскрипты, с доступными датами.
export function listUsers() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(TRANSCRIPTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && USER_RE.test(d.name))
      .map(d => d.name);
  } catch { return []; }

  return dirs.map(user => {
    const udir = path.join(TRANSCRIPTS_DIR, user);
    let dates = [];
    try {
      dates = fs.readdirSync(udir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace(/\.jsonl$/, ''))
        .filter(d => DATE_RE.test(d))
        .sort()
        .reverse();
    } catch {}
    return { user, dates, lastDate: dates[0] || null };
  }).sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
}

// Записи за конкретную дату (или за последнюю доступную, если date не задан).
export function readUser(user, date) {
  if (!USER_RE.test(user)) throw new Error('invalid user');
  const udir = path.join(TRANSCRIPTS_DIR, user);
  if (!fs.existsSync(udir)) return { user, date: null, dates: [], records: [] };

  const dates = fs.readdirSync(udir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace(/\.jsonl$/, ''))
    .filter(d => DATE_RE.test(d))
    .sort().reverse();

  const day = (date && DATE_RE.test(date)) ? date : dates[0];
  if (!day) return { user, date: null, dates, records: [] };

  const file = path.join(udir, `${day}.jsonl`);
  const records = readFile(file);
  return { user, date: day, dates, records };
}

function readFile(file) {
  const records = [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch {}
    }
  } catch {}
  return records;
}

// Все записи ученика за все даты (хронологически, новые сверху).
function readUserAll(user) {
  if (!USER_RE.test(user)) return [];
  const udir = path.join(TRANSCRIPTS_DIR, user);
  if (!fs.existsSync(udir)) return [];
  let out = [];
  for (const f of fs.readdirSync(udir)) {
    if (!f.endsWith('.jsonl')) continue;
    if (!DATE_RE.test(f.replace(/\.jsonl$/, ''))) continue;
    out = out.concat(readFile(path.join(udir, f)));
  }
  return out;
}

// Общая лента: все диалоги всех учеников (или одного), новые сверху, с
// разбивкой-счётчиками по ученикам. Для admin-страницы логов.
export function feed({ user = null, limit = 1500 } = {}) {
  const users = (user && USER_RE.test(user))
    ? [user]
    : listUsers().map(u => u.user);

  let records = [];
  for (const u of users) {
    for (const r of readUserAll(u)) {
      // в записи уже есть r.user; на всякий случай подстрахуемся
      if (!r.user) r.user = u;
      records.push(r);
    }
  }
  records.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

  // счётчики по ученикам считаем по всей выборке (до лимита показа)
  const perUser = {};
  let totalTokens = 0;
  for (const r of records) {
    perUser[r.user] = (perUser[r.user] || 0) + 1;
    totalTokens += (r.usage?.input || 0) + (r.usage?.output || 0);
  }

  const total = records.length;
  if (records.length > limit) records = records.slice(0, limit);
  return { records, perUser, total, totalTokens, truncated: total > limit };
}
