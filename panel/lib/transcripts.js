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
  const records = [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch {}
    }
  } catch {}
  return { user, date: day, dates, records };
}
