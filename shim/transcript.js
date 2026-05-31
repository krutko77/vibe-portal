// transcript.js — сбор диалогов ученик↔Claude для admin-аудита.
//
// Шим — единственная точка, через которую проходят все запросы контейнеров к
// Anthropic (iptables форсит весь трафик на 172.30.0.1:8190, реальный токен в
// контейнер не уходит). Значит здесь же удобно писать транскрипты.
//
// Что пишем: на каждый POST /v1/messages — одну JSONL-запись в
//   TRANSCRIPTS_DIR/<user>/<YYYY-MM-DD>.jsonl
// с текстом последнего user-сообщения и собранным ответом ассистента.
//
// Сопоставление контейнер→ученик: по source-IP. IP контейнера в vibe-net
// присваивается docker'ом, ученик подменить его не может (CAP_DROP=ALL,
// no NET_ADMIN). Карту IP→username строим по docker-лейблу kg.vibe.student.

import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';

const TRANSCRIPTS_DIR = process.env.TRANSCRIPTS_DIR || '/data/config/transcripts';
const NETWORK = process.env.VIBE_NETWORK || 'vibe-net';
const MAP_TTL_MS = 15_000;

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ---------- карта IP → username ----------

let ipMap = new Map();
let ipMapAt = 0;
let refreshing = null;

async function rebuildIpMap() {
  const containers = await docker.listContainers({
    all: false,
    filters: { label: ['kg.vibe.role=workspace'] },
  });
  const next = new Map();
  for (const c of containers) {
    const user = c.Labels?.['kg.vibe.student'];
    if (!user) continue;
    const net = c.NetworkSettings?.Networks?.[NETWORK];
    const ip = net?.IPAddress;
    if (ip) next.set(ip, user);
  }
  ipMap = next;
  ipMapAt = Date.now();
}

// Возвращает username для source-IP контейнера либо null.
// Кэш на MAP_TTL_MS; при промахе принудительно перечитываем (контейнер мог
// только что подняться и получить новый IP).
export async function resolveUser(ip) {
  if (!ip) return null;
  const stale = Date.now() - ipMapAt > MAP_TTL_MS;
  if (stale || !ipMap.has(ip)) {
    if (!refreshing) {
      refreshing = rebuildIpMap().catch(e => {
        console.log(`[shim transcript] ip-map rebuild failed: ${e.message}`);
      }).finally(() => { refreshing = null; });
    }
    await refreshing;
  }
  return ipMap.get(ip) || null;
}

// ---------- разбор запроса ----------

// Из тела запроса достаём модель и текст последнего user-сообщения.
// API stateless: в каждом запросе летит вся история, нам интересен новый ход.
export function parseRequest(bodyBuf) {
  try {
    const j = JSON.parse(bodyBuf.toString('utf8'));
    const msgs = Array.isArray(j.messages) ? j.messages : [];
    const last = msgs[msgs.length - 1];
    let userText = '';
    let isToolContinuation = false;
    if (last) {
      if (typeof last.content === 'string') {
        userText = last.content;
      } else if (Array.isArray(last.content)) {
        userText = last.content
          .filter(b => b && b.type === 'text')
          .map(b => b.text).join('\n');
        const hasToolResult = last.content.some(b => b && b.type === 'tool_result');
        if (!userText && hasToolResult) isToolContinuation = true;
      }
    }
    return { model: j.model || null, numMessages: msgs.length, userText, isToolContinuation };
  } catch {
    return { model: null, numMessages: 0, userText: '', isToolContinuation: false };
  }
}

// ---------- сбор ответа (SSE / JSON) ----------

// Накопитель ответа ассистента. Кормим чанками по мере проксирования,
// в конце отдаём собранный текст / tool-calls / usage / stop_reason.
export class ResponseAccumulator {
  constructor() {
    this.buf = '';
    this.text = '';
    this.tools = [];
    this.model = null;
    this.stopReason = null;
    this.usage = { input: 0, output: 0 };
    this._rawJson = ''; // на случай не-стримящего ответа
    this._isSse = false;
    // undici отдаёт чанки как Uint8Array; декодируем потоково, чтобы
    // многобайтовый UTF-8 на границе чанков не бился.
    this._decoder = new TextDecoder('utf-8');
  }

  push(chunk) {
    const s = (typeof chunk === 'string')
      ? chunk
      : this._decoder.decode(chunk, { stream: true });
    this._rawJson += s;
    this.buf += s;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.startsWith('data:')) {
        this._isSse = true;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try { this._handleEvent(JSON.parse(data)); } catch {}
      }
    }
  }

  _handleEvent(ev) {
    switch (ev.type) {
      case 'message_start':
        this.model = ev.message?.model || this.model;
        if (ev.message?.usage) this.usage.input = ev.message.usage.input_tokens || 0;
        break;
      case 'content_block_start':
        if (ev.content_block?.type === 'tool_use') {
          this.tools.push(ev.content_block.name);
        }
        break;
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta') this.text += ev.delta.text || '';
        break;
      case 'message_delta':
        if (ev.delta?.stop_reason) this.stopReason = ev.delta.stop_reason;
        if (ev.usage?.output_tokens) this.usage.output = ev.usage.output_tokens;
        break;
    }
  }

  // Вызвать в конце. Если ответ был не-стримящим JSON — распарсим целиком.
  finalize() {
    if (!this._isSse && this._rawJson) {
      try {
        const j = JSON.parse(this._rawJson);
        this.model = j.model || this.model;
        this.stopReason = j.stop_reason || this.stopReason;
        if (j.usage) {
          this.usage.input = j.usage.input_tokens || this.usage.input;
          this.usage.output = j.usage.output_tokens || this.usage.output;
        }
        for (const b of (j.content || [])) {
          if (b.type === 'text') this.text += b.text || '';
          if (b.type === 'tool_use') this.tools.push(b.name);
        }
      } catch {}
    }
    return {
      text: this.text,
      tools: this.tools,
      model: this.model,
      stopReason: this.stopReason,
      usage: this.usage,
    };
  }
}

// ---------- запись ----------

function dayStamp(ts) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

const USER_RE = /^[a-zA-Z0-9._-]+$/;

// Дописывает одну JSONL-запись. Никогда не бросает — аудит не должен ронять прокси.
export function write(rec) {
  try {
    const user = rec.user;
    if (!user || !USER_RE.test(user)) return;
    const dir = path.join(TRANSCRIPTS_DIR, user);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${dayStamp(rec.ts)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  } catch (e) {
    console.log(`[shim transcript] write failed: ${e.message}`);
  }
}
