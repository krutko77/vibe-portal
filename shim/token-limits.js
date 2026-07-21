// token-limits.js — проверка и учёт расходов учеников на Claude API.
//
// Использует два файла (общие между шимом и панелью):
//   USERS_FILE        — /data/config/auth/users-vibe.json  (поля spendLimitUsd, tokenPeriod)
//   TOKEN_USAGE_FILE  — /data/config/env/token-usage.json  (счётчики)

import fs from 'node:fs';

const USERS_FILE     = process.env.USERS_FILE        || '/data/config/auth/users-vibe.json';
const USAGE_FILE     = process.env.TOKEN_USAGE_FILE  || '/data/config/env/token-usage.json';

// Цены в $ за 1M токенов [input, output]
const PRICES = {
  haiku:  [0.80,  4.00],
  sonnet: [3.00,  15.00],
  opus:   [15.00, 75.00],
};

function modelCost(model, input, output) {
  let key = 'sonnet';
  if (model) {
    const m = model.toLowerCase();
    if (m.includes('haiku')) key = 'haiku';
    else if (m.includes('opus')) key = 'opus';
  }
  const [ip, op] = PRICES[key];
  return (input * ip + output * op) / 1_000_000;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch { return { users: {} }; }
}

function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')); } catch { return {}; }
}

function saveUsage(data) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

// Возвращает { spent, limitUsd, period } если лимит превышён, иначе null.
export function checkLimit(username) {
  const state = loadUsers();
  const user  = state.users?.[username];
  if (!user || !user.spendLimitUsd) return null;

  const period = user.tokenPeriod || 'total';
  const udata  = loadUsage()[username] || {};
  const monthKey = todayKey().slice(0, 7);
  const spent  = period === 'day'
    ? (udata.days?.[todayKey()] || 0)
    : period === 'month'
      ? Object.entries(udata.days || {}).filter(([d]) => d.startsWith(monthKey)).reduce((s, [, v]) => s + v, 0)
      : (udata.totalUsd || 0);

  return spent >= user.spendLimitUsd
    ? { spent, limitUsd: user.spendLimitUsd, period }
    : null;
}

// Записывает стоимость одного запроса.
export function recordUsage(username, model, inputTokens, outputTokens) {
  if (!username || (!inputTokens && !outputTokens)) return;
  try {
    const cost  = modelCost(model, inputTokens || 0, outputTokens || 0);
    const usage = loadUsage();
    if (!usage[username]) usage[username] = { totalUsd: 0, days: {} };
    usage[username].totalUsd              = (usage[username].totalUsd || 0) + cost;
    const day = todayKey();
    if (!usage[username].days) usage[username].days = {};
    usage[username].days[day]             = (usage[username].days[day] || 0) + cost;
    saveUsage(usage);
  } catch (e) {
    console.log(`[token-limits] recordUsage failed: ${e.message}`);
  }
}
