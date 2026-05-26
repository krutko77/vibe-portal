// Проверка htpasswd-vibe + загрузка/сохранение users-vibe.json.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HTPASSWD_FILE = process.env.HTPASSWD_FILE
  || '/data/config/auth/.htpasswd-vibe';
const USERS_FILE = process.env.USERS_FILE
  || '/data/config/auth/users-vibe.json';

export function ensureFiles() {
  for (const f of [HTPASSWD_FILE, USERS_FILE]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
  }
  if (!fs.existsSync(HTPASSWD_FILE)) fs.writeFileSync(HTPASSWD_FILE, '');
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({
      users: {}, ports: { nextFree: 8200 },
    }, null, 2));
  }
}

export function loadUsers() {
  ensureFiles();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

export function saveUsers(state) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(state, null, 2));
}

export function htpasswdCheck(username, password) {
  if (!username || !password) return false;
  if (!/^[a-z][a-z0-9_-]{1,30}$/i.test(username)) return false;
  const r = spawnSync('htpasswd', ['-vb', HTPASSWD_FILE, username, password], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return r.status === 0;
}

export function htpasswdSet(username, password) {
  if (!/^[a-z][a-z0-9_-]{1,30}$/i.test(username)) {
    throw new Error('invalid username');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('password too short');
  }
  ensureFiles();
  const r = spawnSync('htpasswd', ['-bB', HTPASSWD_FILE, username, password], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) throw new Error('htpasswd failed: ' + r.stderr.toString());
}

export function htpasswdDelete(username) {
  ensureFiles();
  const r = spawnSync('htpasswd', ['-D', HTPASSWD_FILE, username], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // -D возвращает ненулевой код если пользователя нет — это ок
  return r.status === 0;
}

export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'unauthorized' });
}

export function requireAdmin(req, res, next) {
  if (req.session?.user && req.session.isAdmin) return next();
  res.status(403).json({ error: 'forbidden' });
}
