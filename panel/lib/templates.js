// Чтение каталога шаблонов dev-портала (ro для vibe) + копирование в workspace ученика.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/opt/dev-portal/templates/vibe';

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
