// Просмотрщик файлов проекта ученика: дерево + чтение содержимого.
// Все пути санитизируются — выйти за пределы projectRoot нельзя.

import fs from 'node:fs';
import path from 'node:path';

const MAX_DEPTH = 5;
const MAX_FILE_BYTES = 200 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.cache', '__pycache__', 'dist', 'build', '.venv']);

function isProbablyBinary(buf) {
  // Если в первых 4КБ есть NUL или >30% не-ASCII печатных символов — считаем бинарём.
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let nonText = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32) || b === 127) nonText++;
  }
  return nonText / sample.length > 0.3;
}

// Безопасное разрешение `relPath` внутри `root`.
// Возвращает абсолютный путь или null, если попытка выйти за пределы.
export function resolveSafe(root, relPath) {
  if (!relPath) return root;
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

export function buildTree(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  function walk(dir, depth) {
    if (depth > MAX_DEPTH) return [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const items = [];
    for (const ent of entries) {
      if (ent.name.startsWith('.git/')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        items.push({
          name: ent.name,
          type: 'dir',
          children: walk(full, depth + 1),
        });
      } else if (ent.isFile()) {
        items.push({ name: ent.name, type: 'file' });
      }
    }
    // Папки сверху, потом файлы; внутри — по алфавиту.
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return items;
  }

  return walk(rootDir, 0);
}

export function readFileSafe(rootDir, relPath) {
  const abs = resolveSafe(rootDir, relPath);
  if (!abs) throw new Error('invalid path');
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error('not a file');

  if (st.size > MAX_FILE_BYTES) {
    return { binary: false, truncated: true, size: st.size, content: '' };
  }
  const buf = fs.readFileSync(abs);
  if (isProbablyBinary(buf)) {
    return { binary: true, truncated: false, size: st.size, content: '' };
  }
  return { binary: false, truncated: false, size: st.size, content: buf.toString('utf8') };
}
