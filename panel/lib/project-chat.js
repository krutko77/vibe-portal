// Chat Claude по проекту (port из dev-portal'а с адаптацией под vibe).
//
// State: /root/.claude/projects/-data-vibe-students-<user>-<project>/<sessionId>.jsonl
//        + <sessionId>.meta.json (sidecar)
//
// Каждое сообщение спавнит `claude -p ... --resume <sid> --output-format stream-json`
// в cwd = /data/vibe-students/<user>/<project>/. Парсит NDJSON → SSE-события в браузер.

import { spawn, execFile } from 'node:child_process';
import { readdir, readFile, writeFile, rename as renameFile, unlink, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/usr/bin/claude';
const STUDENTS_ROOT = process.env.STUDENTS_ROOT || '/data/vibe-students';
const CLAUDE_PROJECTS_DIR = '/root/.claude/projects';
const STREAM_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TITLE_LEN = 80;

// sessionId → { pid, user, child }
const activeProcs = new Map();

// Claude Code CLI хранит сессии в /root/.claude/projects/-<cwd-with-slashes-as-dashes>/
function claudeDirFor(username, projectSlug) {
  return join(CLAUDE_PROJECTS_DIR, `-data-vibe-students-${username}-${projectSlug}`);
}
function projectCwd(username, projectSlug) {
  return join(STUDENTS_ROOT, username, projectSlug);
}
function sessionFile(username, slug, sid) {
  return join(claudeDirFor(username, slug), sid + '.jsonl');
}
function metaFile(username, slug, sid) {
  return join(claudeDirFor(username, slug), sid + '.meta.json');
}

async function readMeta(username, slug, sid) {
  try { return JSON.parse(await readFile(metaFile(username, slug, sid), 'utf8')); }
  catch { return null; }
}
async function writeMeta(username, slug, sid, meta) {
  const dir = claudeDirFor(username, slug);
  await mkdir(dir, { recursive: true });
  const path = metaFile(username, slug, sid);
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8');
  await renameFile(tmp, path);
}
async function updateMeta(username, slug, sid, patch) {
  const cur = (await readMeta(username, slug, sid)) || {};
  const next = { ...cur, ...patch };
  await writeMeta(username, slug, sid, next);
  return next;
}

async function firstUserMessage(jsonlPath) {
  try {
    const raw = await readFile(jsonlPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      if (obj?.type === 'user') {
        const content = obj?.message?.content;
        // CLI пишет content либо строкой, либо массивом блоков.
        if (typeof content === 'string' && content.trim()) {
          return content.trim();
        }
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
              return c.text.trim();
            }
          }
        }
      }
    }
  } catch {}
  return '';
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Внешние claude-процессы (другая вкладка / VS Code) — блокируем resume
async function findExternalClaudeForSession(sessionId) {
  if (!sessionId || !/^[a-f0-9-]{36}$/i.test(sessionId)) return null;
  let stdout = '';
  try {
    const r = await execFileP('pgrep', ['-af', `[-][-]resume[= ]${sessionId}`]);
    stdout = r.stdout;
  } catch { return null; }
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pid = parseInt(trimmed.split(/\s+/)[0], 10);
    if (!pid) continue;
    let isOurs = false;
    for (const v of activeProcs.values()) if (v.pid === pid) { isOurs = true; break; }
    if (isOurs) continue;
    let source = 'другой процесс';
    if (trimmed.includes('code-server')) source = 'VS Code (web)';
    return { pid, source };
  }
  return null;
}

export async function listSessions(username, projectSlug) {
  const dir = claudeDirFor(username, projectSlug);
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const jsonls = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl'));
  const out = [];
  for (const e of jsonls) {
    const sessionId = e.name.replace(/\.jsonl$/, '');
    const filePath = join(dir, e.name);
    const s = await stat(filePath).catch(() => null);
    if (!s) continue;
    let meta = await readMeta(username, projectSlug, sessionId);
    if (!meta) {
      const firstMsg = await firstUserMessage(filePath);
      meta = {
        sessionId,
        projectSlug,
        createdBy: 'vscode',
        createdAt: s.birthtime.toISOString(),
        lastWriterBy: 'vscode',
        lastWriteAt: s.mtime.toISOString(),
        lockedBy: null,
        title: truncate(firstMsg || 'Без темы', MAX_TITLE_LEN),
      };
      try { await writeMeta(username, projectSlug, sessionId, meta); } catch {}
    } else {
      // Старые/частичные meta (например, записанные send-флоу без sessionId) —
      // достраиваем обязательные поля, иначе фронт падает на sessionId.slice().
      meta.sessionId = sessionId;
      meta.lastWriteAt = meta.lastWriteAt || s.mtime.toISOString();
      if (!meta.title) meta.title = truncate((await firstUserMessage(filePath)) || 'Без темы', MAX_TITLE_LEN);
    }
    if (meta.lockedBy && !activeProcs.has(sessionId)) {
      meta.lockedBy = null;
      try { await writeMeta(username, projectSlug, sessionId, meta); } catch {}
    }
    out.push(meta);
  }
  await Promise.all(out.map(async (meta) => {
    if (meta.lockedBy) return;
    const ext = await findExternalClaudeForSession(meta.sessionId);
    if (ext) { meta.lockedBy = ext.source; meta.externalLock = true; }
  }));
  out.sort((a, b) => (b.lastWriteAt || '').localeCompare(a.lastWriteAt || ''));
  return out;
}

export async function loadSessionHistory(username, projectSlug, sessionId) {
  const path = sessionFile(username, projectSlug, sessionId);
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch { return []; }
  const blocks = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    const mapped = mapJsonlEntryToBlocks(obj);
    if (mapped) blocks.push(...mapped);
  }
  return blocks;
}

function mapJsonlEntryToBlocks(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const t = obj.type;
  if (t === 'user' && typeof obj.message?.content === 'string') {
    const text = obj.message.content;
    return text.trim() ? [{ role: 'user', type: 'text', text, ts: obj.timestamp }] : null;
  }
  if (t === 'user' && Array.isArray(obj.message?.content)) {
    const out = [];
    for (const c of obj.message.content) {
      if (c.type === 'text' && typeof c.text === 'string') {
        out.push({ role: 'user', type: 'text', text: c.text, ts: obj.timestamp });
      } else if (c.type === 'tool_result') {
        const content = Array.isArray(c.content)
          ? c.content.map(x => x.text || '').join('')
          : (typeof c.content === 'string' ? c.content : '');
        out.push({
          role: 'assistant', type: 'tool_result',
          toolUseId: c.tool_use_id, content,
          isError: !!c.is_error, ts: obj.timestamp,
        });
      }
    }
    return out.length ? out : null;
  }
  if (t === 'assistant' && Array.isArray(obj.message?.content)) {
    const out = [];
    for (const c of obj.message.content) {
      if (c.type === 'text' && typeof c.text === 'string') {
        out.push({ role: 'assistant', type: 'text', text: c.text });
      } else if (c.type === 'thinking' && typeof c.thinking === 'string') {
        out.push({ role: 'assistant', type: 'thinking', text: c.thinking });
      } else if (c.type === 'tool_use') {
        out.push({
          role: 'assistant', type: 'tool_use',
          tool: c.name, input: c.input, toolUseId: c.id,
        });
      }
    }
    return out.length ? out : null;
  }
  return null;
}

const FULL_TOOLS = [
  'Read', 'Edit', 'Write', 'NotebookEdit', 'Grep', 'Glob',
  'Bash', 'Task', 'WebFetch', 'WebSearch', 'Skill',
];

export async function sendMessage(res, opts) {
  const { username, projectSlug, text, model } = opts;
  let { sessionId } = opts;
  const cwd = projectCwd(username, projectSlug);

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  if (sessionId && activeProcs.has(sessionId)) {
    send('error', { message: `Сессия занята юзером ${activeProcs.get(sessionId).user}` });
    return res.end();
  }
  if (sessionId) {
    const ext = await findExternalClaudeForSession(sessionId);
    if (ext) {
      send('error', { message: `Сессия занята: ${ext.source} (pid ${ext.pid}). Закрой там и попробуй снова.` });
      return res.end();
    }
  }

  const args = [
    '-p', text,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowed-tools', FULL_TOOLS.join(' '),
    '--append-system-prompt',
    'Общайся и думай на русском языке. Все комментарии, планы, рассуждения и пояснения — по-русски, кроме имён файлов, команд и кода. Пиши кратко: без длинных преамбул и перечислений плюсов/минусов перед действием. Сначала действуй, потом коротко отчитайся о результате.',
  ];
  if (sessionId) args.push('--resume', sessionId);
  if (model && model !== 'auto') args.push('--model', model);
  else if (!model) args.push('--model', 'sonnet');

  const child = spawn(CLAUDE_BIN, args, {
    cwd,
    env: { ...process.env, HOME: '/root' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lockInMemory = (sid) => {
    if (activeProcs.has(sid)) return false;
    activeProcs.set(sid, { pid: child.pid, user: username, startedAt: Date.now(), child });
    return true;
  };
  if (sessionId) {
    lockInMemory(sessionId);
    updateMeta(username, projectSlug, sessionId, { lockedBy: username }).catch(() => {});
  }

  const killTimer = setTimeout(() => {
    try { child.kill('SIGTERM'); } catch {}
    send('error', { message: `Timeout (${STREAM_TIMEOUT_MS / 1000}s)` });
  }, STREAM_TIMEOUT_MS);

  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) handleNdjsonLine(line);
    }
  });
  child.stderr.on('data', d => {
    const s = d.toString('utf8').trim();
    if (s) send('log', { stream: 'stderr', text: s });
  });
  child.on('error', err => {
    clearTimeout(killTimer);
    send('error', { message: 'Failed to spawn claude: ' + err.message });
    finalize();
  });
  child.on('close', code => {
    clearTimeout(killTimer);
    send('done', { code });
    finalize();
  });
  res.on('close', () => {
    try { child.kill('SIGTERM'); } catch {}
    clearTimeout(killTimer);
    finalize();
  });

  function finalize() {
    if (sessionId) {
      activeProcs.delete(sessionId);
      updateMeta(username, projectSlug, sessionId, {
        lockedBy: null,
        lastWriterBy: username,
        lastWriteAt: new Date().toISOString(),
      }).catch(() => {});
    }
    try { res.end(); } catch {}
  }

  function handleNdjsonLine(line) {
    let obj;
    try { obj = JSON.parse(line); }
    catch { send('log', { stream: 'parse-error', text: line.slice(0, 200) }); return; }
    if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
      if (!sessionId) {
        sessionId = obj.session_id;
        send('session', { sessionId, model: obj.model });
        lockInMemory(sessionId);
        const title = truncate(text, MAX_TITLE_LEN);
        writeMeta(username, projectSlug, sessionId, {
          sessionId, projectSlug,
          createdBy: username,
          createdAt: new Date().toISOString(),
          lastWriterBy: username,
          lastWriteAt: new Date().toISOString(),
          lockedBy: username,
          title,
        }).catch(() => {});
      }
      return;
    }
    if (obj.type === 'system' && obj.subtype === 'api_retry') {
      send('log', { stream: 'retry', attempt: obj.attempt, delay_ms: obj.retry_delay_ms });
      return;
    }
    if (obj.type === 'rate_limit_event') {
      send('log', { stream: 'rate_limit', ...obj.rate_limit_info });
      return;
    }
    if (obj.type === 'result') {
      const usage = obj.usage || {};
      send('summary', {
        tokenInput: usage.input_tokens,
        tokenOutput: usage.output_tokens,
        costUsd: obj.total_cost_usd,
        durationMs: obj.duration_ms,
        stopReason: obj.stop_reason || obj.subtype,
      });
      return;
    }
    const blocks = mapJsonlEntryToBlocks(obj);
    if (blocks) for (const b of blocks) send('block', b);
  }
}

export async function deleteSession(username, projectSlug, sessionId) {
  if (activeProcs.has(sessionId)) {
    throw new Error('Сессия сейчас активна — дождись завершения');
  }
  await unlink(sessionFile(username, projectSlug, sessionId)).catch(() => {});
  await unlink(metaFile(username, projectSlug, sessionId)).catch(() => {});
}

// Гарантирует cwd = workspace ученика существует (на случай если ещё не создан).
export async function ensureProjectCwd(username, projectSlug) {
  const cwd = projectCwd(username, projectSlug);
  await mkdir(cwd, { recursive: true });
  return cwd;
}
