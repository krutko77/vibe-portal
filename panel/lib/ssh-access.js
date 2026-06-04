// SSH-доступ ученика для десктопного VS Code (Remote-SSH).
// sshd живёт ВНУТРИ контейнера ученика (от student, non-root, только pubkey).
// Панель генерит ключи и кладёт публичную часть в контейнер.
//
// Раскладка на хосте /data/config/ssh/<user>/:
//   id_ed25519, id_ed25519.pub   — личный ключ ученика (для скачивания), В КОНТЕЙНЕР НЕ монтируется
//   host/authorized_keys          — публичный ключ ученика (sshd пускает по нему)
//   host/ssh_host_ed25519_key(.pub) — host-key контейнерного sshd (персист → отпечаток не меняется)
// В контейнер монтируется ТОЛЬКО подпапка host/ → /home/student/.sshd (приватник не утекает в контейнер).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SSH_ROOT = process.env.SSH_KEYS_DIR || '/data/config/ssh';
const SSH_HOST = process.env.SSH_PUBLIC_HOST || 'vibe.kiselevgroup.com';
const STUDENT_UID = 1000;
const STUDENT_GID = 1000;

export function sshDir(username) { return path.join(SSH_ROOT, username); }
export function sshMountDir(username) { return path.join(sshDir(username), 'host'); }

function keygen(file, comment) {
  for (const f of [file, file + '.pub']) { try { fs.unlinkSync(f); } catch {} }
  const r = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', file, '-N', '', '-C', comment, '-q'],
    { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ssh-keygen failed: ' + (r.stderr || r.stdout));
}

// chown host/ в 1000:1000 — sshd в контейнере читает authorized_keys/host-key как uid 1000.
function fixPerms(username) {
  const mnt = sshMountDir(username);
  fs.chmodSync(mnt, 0o700);
  for (const f of fs.readdirSync(mnt)) fs.chmodSync(path.join(mnt, f), 0o600);
  spawnSync('chown', ['-R', `${STUDENT_UID}:${STUDENT_GID}`, mnt]);
  // личный ключ держим root-only (только панель отдаёт его на скачивание)
  for (const f of ['id_ed25519', 'id_ed25519.pub']) {
    const p = path.join(sshDir(username), f);
    if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
  }
}

// Идемпотентно: гарантирует личный ключ + host-key + authorized_keys.
export function ensureKeys(username) {
  const dir = sshDir(username);
  const mnt = sshMountDir(username);
  fs.mkdirSync(mnt, { recursive: true });
  const priv = path.join(dir, 'id_ed25519');
  const host = path.join(mnt, 'ssh_host_ed25519_key');
  if (!fs.existsSync(priv)) keygen(priv, `vibe-${username}`);
  if (!fs.existsSync(host)) keygen(host, `vibe-host-${username}`);
  fs.writeFileSync(path.join(mnt, 'authorized_keys'),
    fs.readFileSync(priv + '.pub', 'utf8').trim() + '\n', { mode: 0o600 });
  fixPerms(username);
}

// Перевыпуск личного ключа (host-key НЕ трогаем — отпечаток сервера остаётся прежним).
export function regenerateKeys(username) {
  const dir = sshDir(username);
  for (const f of ['id_ed25519', 'id_ed25519.pub']) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  try { fs.unlinkSync(path.join(sshMountDir(username), 'authorized_keys')); } catch {}
  ensureKeys(username);
}

export function removeKeys(username) {
  fs.rmSync(sshDir(username), { recursive: true, force: true });
}

export function privateKey(username) {
  return fs.readFileSync(path.join(sshDir(username), 'id_ed25519'), 'utf8');
}

export function hostPublicKey(username) {
  return fs.readFileSync(path.join(sshMountDir(username), 'ssh_host_ed25519_key.pub'), 'utf8').trim();
}

// Данные подключения для UI: ssh-config сниппет, known_hosts-строка, deep-links.
export function sshConfig(username, sshPort) {
  const alias = `vibe-${username}`;
  let knownHostsLine = '';
  try {
    knownHostsLine = `[${SSH_HOST}]:${sshPort} ${hostPublicKey(username)}`;
  } catch { /* host-key ещё не сгенерён */ }
  return {
    host: SSH_HOST,
    port: sshPort,
    user: 'student',
    alias,
    // StrictHostKeyChecking accept-new — авто-приём host-key при первом коннекте
    // (host-key персистит, не меняется), чтобы ученик не упирался в вопрос об отпечатке.
    configSnippet:
      `Host ${alias}\n    HostName ${SSH_HOST}\n    Port ${sshPort}\n    User student\n    IdentityFile ~/.ssh/${alias}\n    StrictHostKeyChecking accept-new\n`,
    knownHostsLine,
    keyFileName: alias,
    workspaceUri: `vscode://vscode-remote/ssh-remote+${alias}/home/student/workspace`,
    projectUriBase: `vscode://vscode-remote/ssh-remote+${alias}/home/student/workspace/`,
  };
}
