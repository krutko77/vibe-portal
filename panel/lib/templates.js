// Чтение каталога курсовых шаблонов (ro) + копирование в workspace ученика.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/opt/vibe-portal/templates';

export function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map(d => {
      const dir = path.join(TEMPLATES_DIR, d.name);
      let desc = '';
      const cm = path.join(dir, 'CLAUDE.md');
      if (fs.existsSync(cm)) {
        const md = fs.readFileSync(cm, 'utf-8');
        const m = md.match(/^#\s+.+\n\n([^\n]+(?:\n[^\n]+)?)/);
        if (m) desc = m[1].slice(0, 240).replace(/\s+/g, ' ');
      }
      return { name: d.name, description: desc };
    });
}

// «Базовые» (стартовые) шаблоны — папки с префиксом `_`, для модалки «+ Шаблон».
// Жёстко прописанные label/desc — чтобы пользователю показывался человекочитаемый
// заголовок без необходимости править CLAUDE.md.
const BASE_TEMPLATES = [
  {
    name: '_base',
    title: 'Шаблон для Битрикс24 + VibeCode',
    description: 'Node.js + Express + vanilla JS. Деплой на vibecode.bitrix24.tech. Для большинства приложений Б24.',
  },
  {
    name: '_base_universal',
    title: 'Б24 + VibeCode с журналом истории',
    description: 'Тот же стек, что и базовый, плюс память проекта (docs/ + автокоммиты): что делали, где сейчас, куда идём. Для передачи проекта другому исполнителю без потери контекста.',
  },
  {
    name: '_b24-single-php',
    title: 'PHP / REST / API Битрикс24',
    description: 'Single-tenant B24 local-app: PHP-бэк, vanilla JS, файловый store без БД. Для интеграций с REST API Битрикс24.',
  },
];

export function listBaseTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return BASE_TEMPLATES.filter(t => fs.existsSync(path.join(TEMPLATES_DIR, t.name)));
}

export function createEmptyProject({ workspaceDir, projectName }) {
  if (!/^[a-z][a-z0-9_-]{1,50}$/i.test(projectName)) {
    throw new Error('invalid project name');
  }
  const dst = path.join(workspaceDir, projectName);
  if (fs.existsSync(dst)) throw new Error('project already exists');
  fs.mkdirSync(dst, { recursive: true });
  spawnSync('chown', ['1000:1000', dst]);
  return { name: projectName, path: dst };
}

// Создать проект из загруженной учеником папки.
// files: [{ relPath, buffer }] — relPath приходит из webkitRelativePath
// (forward-slashes, первый сегмент = имя выбранной папки, его срезаем).
// Все файлы пишутся под dst, затем chown -R 1000:1000 — иначе ученик в
// контейнере (uid 1000) не сможет открыть проект (чёрный экран code-server).
export function createUploadedProject({ workspaceDir, projectName, files }) {
  if (!/^[a-z][a-z0-9_-]{1,50}$/i.test(projectName)) {
    throw new Error('invalid project name');
  }
  if (!Array.isArray(files) || !files.length) {
    throw new Error('no files');
  }
  const dst = path.join(workspaceDir, projectName);
  if (fs.existsSync(dst)) {
    throw new Error('project already exists');
  }
  const dstReal = path.resolve(dst);
  fs.mkdirSync(dst, { recursive: true });
  let written = 0;
  try {
    for (const f of files) {
      const rel = sanitizeRelPath(f.relPath);
      if (!rel) continue;
      const target = path.resolve(dst, rel);
      if (target !== dstReal && !target.startsWith(dstReal + path.sep)) continue; // traversal
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.buffer);
      written++;
    }
  } catch (e) {
    fs.rmSync(dst, { recursive: true, force: true });
    throw e;
  }
  if (!written) {
    fs.rmSync(dst, { recursive: true, force: true });
    throw new Error('no valid files');
  }
  const r = spawnSync('chown', ['-R', '1000:1000', dst], { stdio: 'pipe' });
  if (r.status !== 0) {
    throw new Error('chown failed: ' + r.stderr.toString());
  }
  return { name: projectName, path: dst, files: written };
}

// Срезает верхнюю папку, отбрасывает node_modules/.git и любой `..`.
function sanitizeRelPath(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  let parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length > 1) parts = parts.slice(1); // имя выбранной папки
  if (!parts.length) return null;
  if (parts.some(p => p === '..' || p === '.')) return null;
  if (parts.some(p => p === 'node_modules' || p === '.git')) return null;
  return parts.join('/');
}

export function instantiateTemplate({ templateName, workspaceDir, projectName }) {
  if (!/^[a-z][a-z0-9_-]{1,50}$/i.test(projectName)) {
    throw new Error('invalid project name');
  }
  const src = path.join(TEMPLATES_DIR, templateName);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    throw new Error('template not found');
  }
  const dst = path.join(workspaceDir, projectName);
  if (fs.existsSync(dst)) {
    throw new Error('project already exists');
  }
  // cp -a + chown на student uid 1000
  let r = spawnSync('cp', ['-a', src + '/.', dst], { stdio: 'pipe' });
  if (r.status !== 0) {
    throw new Error('cp failed: ' + r.stderr.toString());
  }
  r = spawnSync('chown', ['-R', '1000:1000', dst], { stdio: 'pipe' });
  if (r.status !== 0) {
    throw new Error('chown failed: ' + r.stderr.toString());
  }
  // Подставляем {{PROJECT_NAME}} в текстовых файлах (по аналогии с new-project.sh)
  const date = new Date().toISOString().slice(0, 10);
  substituteVars(dst, { PROJECT_NAME: projectName, PROJECT_DATE: date });
  return { name: projectName, path: dst };
}

function substituteVars(dir, vars) {
  const exts = new Set(['.md', '.json', '.js', '.ts', '.sh', '.html', '.css', '.txt', '.env.example']);
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        walk(p);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name);
        if (!exts.has(ext) && !ent.name.startsWith('.env')) continue;
        try {
          let s = fs.readFileSync(p, 'utf-8');
          let changed = false;
          for (const [k, v] of Object.entries(vars)) {
            const re = new RegExp('\\{\\{' + k + '\\}\\}', 'g');
            if (re.test(s)) { s = s.replace(re, v); changed = true; }
          }
          if (changed) fs.writeFileSync(p, s);
        } catch {}
      }
    }
  };
  walk(dir);
}
