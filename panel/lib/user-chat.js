// Общий чат-помощник в папке пользователя. Stateless для Claude (без --resume),
// in-memory история на сервере (последние 10 обменов) — короткий контекст
// помещаем в сам prompt. spawn `claude -p ... --output-format text` (блок. ответ).

import { spawn } from 'node:child_process';
import * as transcripts from './transcripts.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/usr/bin/claude';
const STUDENTS_ROOT = process.env.STUDENTS_ROOT || '/data/vibe-students';
const CHAT_TIMEOUT_MS = 90_000;

const history = new Map();  // username → [{role, content}]

function homeFor(username) { return `${STUDENTS_ROOT}/${username}`; }

const SYSTEM_PROMPT = [
  'Ты — ассистент vibe-портала, на портале студенты курса «Vibecoding» от Киселёв Груп.',
  'Помогаешь ученику планировать новый проект — простое веб-приложение из имеющихся курсовых шаблонов.',
  'Шаблоны лежат в /home/student/templates/ (read-only в его контейнере), их имена начинаются с app-.',
  'Когда ясно из чего создать проект и как назвать — выведи СТРОГО на отдельной строке:',
  '  CREATE_PROJECT template=app-<имя-шаблона> name=<имя-проекта>',
  'Имя проекта — латиница, цифры, дефис. Будь краток. Отвечай на языке пользователя.',
].join('\n');

export function getHistory(username) {
  return history.get(username) || [];
}

export function clearHistory(username) {
  history.delete(username);
}

export function send(req, res) {
  const { message } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const username = req.session.user;
  if (!history.has(username)) history.set(username, []);
  const hist = history.get(username);

  let prompt = message;
  if (hist.length > 0) {
    const ctx = hist.slice(-10).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    prompt = `${ctx}\nUser: ${message}`;
  }

  const child = spawn(CLAUDE_BIN, [
    '-p', prompt,
    '--system-prompt', SYSTEM_PROMPT,
    '--model', 'sonnet',
    '--allowed-tools', '',
    '--output-format', 'text',
  ], {
    cwd: homeFor(username),
    // см. project-chat: отключаем авто-1M-контекст (иначе на длинном диалоге
    // CLI просит платные usage credits → ошибка у ученика).
    env: { ...process.env, HOME: '/root', CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', d => { out += d.toString('utf8'); });
  child.stderr.on('data', () => {});

  let responded = false;
  const t = setTimeout(() => {
    if (responded) return;
    responded = true;
    try { child.kill('SIGTERM'); } catch {}
    res.status(408).json({ error: 'Claude не ответил за 90 секунд' });
  }, CHAT_TIMEOUT_MS);

  child.on('close', code => {
    clearTimeout(t);
    if (responded) return;
    responded = true;
    if (code !== 0) return res.status(500).json({ error: 'Claude завершился с ошибкой' });
    const response = out.trim();
    hist.push({ role: 'user', content: message });
    hist.push({ role: 'assistant', content: response });
    if (hist.length > 20) hist.splice(0, 2);
    transcripts.write({
      ts: new Date().toISOString(),
      user: username,
      source: 'user-chat',
      model: 'sonnet',
      userText: message,
      assistantText: response,
      toolCalls: [],
      usage: {},
    });
    const m = response.match(/CREATE_PROJECT\s+template=([a-zA-Z0-9._-]+)\s+name=([a-zA-Z0-9._-]+)/);
    res.json({
      response,
      createProject: m ? { template: m[1], name: m[2] } : null,
    });
  });

  child.on('error', err => {
    clearTimeout(t);
    if (responded) return;
    responded = true;
    res.status(500).json({ error: 'spawn failed: ' + err.message });
  });
}
