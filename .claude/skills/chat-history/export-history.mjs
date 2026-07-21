#!/usr/bin/env node
// Экспортирует историю сессии(й) Claude Code из ~/.claude/projects/<slug>/<session>.jsonl
// в читаемый Markdown. Тянет только реальный диалог (текст пользователя/ассистента),
// tool_use/tool_result/thinking сворачивает в короткую сводку по инструментам.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function parseArgs(argv) {
  const args = { session: process.env.CLAUDE_CODE_SESSION_ID || null, all: false, list: false, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") args.session = argv[++i];
    else if (a === "--all") args.all = true;
    else if (a === "--list") args.list = true;
    else if (a === "--cwd") args.cwd = argv[++i];
  }
  return args;
}

function projectDirFor(cwd) {
  const slug = cwd.replace(/\//g, "-");
  return path.join(os.homedir(), ".claude", "projects", slug);
}

function readJsonl(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // пропускаем битые/неполные строки
    }
  }
  return out;
}

function textFromBlocks(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function toolNamesFromBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && b.type === "tool_use" && b.name).map((b) => b.name);
}

function isRealUserMessage(entry) {
  if (entry.type !== "user") return false;
  const content = entry.message?.content;
  if (typeof content === "string") return content.trim().length > 0;
  // массив контента: пользовательский текст (напр. с attachments), а не голый tool_result
  return textFromBlocks(content).trim().length > 0;
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function tallyTools(names) {
  const counts = {};
  for (const n of names) counts[n] = (counts[n] || 0) + 1;
  return Object.entries(counts)
    .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
    .join(", ");
}

// Строит Markdown из плоского списка jsonl-записей одной сессии.
function renderSession(entries, sessionId) {
  const chatEntries = entries.filter((e) => e.type === "user" || e.type === "assistant");
  if (chatEntries.length === 0) return null;

  const firstTs = chatEntries[0].timestamp;
  const lines = [];
  let pendingText = [];
  let pendingTools = [];

  function flushAssistant() {
    if (pendingText.length === 0 && pendingTools.length === 0) return;
    lines.push(`## Ассистент`);
    if (pendingTools.length > 0) {
      lines.push(`_(инструменты: ${tallyTools(pendingTools)})_`);
      lines.push("");
    }
    if (pendingText.length > 0) {
      lines.push(pendingText.join("\n\n"));
    }
    lines.push("");
    pendingText = [];
    pendingTools = [];
  }

  for (const entry of chatEntries) {
    if (entry.type === "user") {
      if (!isRealUserMessage(entry)) continue; // голый tool_result — пропускаем
      flushAssistant();
      const text = textFromBlocks(entry.message.content);
      lines.push(`## Пользователь — ${fmtTime(entry.timestamp)}`);
      lines.push(text);
      lines.push("");
    } else if (entry.type === "assistant") {
      const content = entry.message?.content;
      const text = textFromBlocks(content);
      if (text) pendingText.push(text);
      pendingTools.push(...toolNamesFromBlocks(content));
    }
  }
  flushAssistant();

  const header = [`# История чата — ${path.basename(process.cwd())}`, `_Сессия: ${sessionId} · начало ${fmtTime(firstTs)}_`, ""];
  return header.concat(lines).join("\n").trimEnd() + "\n";
}

function listSessions(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      const entries = readJsonl(full);
      const firstUser = entries.find((e) => isRealUserMessage(e));
      const preview = firstUser ? textFromBlocks(firstUser.message.content).slice(0, 60).replace(/\n/g, " ") : "(нет реплик)";
      return { id: f.replace(/\.jsonl$/, ""), mtime: stat.mtime, preview };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projDir = projectDirFor(args.cwd);
  const outDir = path.join(args.cwd, ".claude", "chat-history");

  if (args.list) {
    const sessions = listSessions(projDir);
    for (const s of sessions) {
      console.log(`${s.id}  ${s.mtime.toISOString().slice(0, 16).replace("T", " ")}  ${s.preview}`);
    }
    return;
  }

  const targets = args.all ? listSessions(projDir).map((s) => s.id) : [args.session];
  if (!targets[0]) {
    console.error("Не задана сессия: передай --session <id>, --all, либо запусти внутри Claude Code (нужен CLAUDE_CODE_SESSION_ID).");
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  for (const sessionId of targets) {
    const file = path.join(projDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(file)) {
      console.error(`Пропуск: не найден транскрипт ${file}`);
      continue;
    }
    const entries = readJsonl(file);
    const md = renderSession(entries, sessionId);
    if (!md) {
      console.error(`Пропуск: в сессии ${sessionId} нет диалога`);
      continue;
    }
    const dateStr = new Date(entries.find((e) => e.type === "user" || e.type === "assistant")?.timestamp || Date.now())
      .toISOString()
      .slice(0, 10);
    const outFile = path.join(outDir, `${dateStr}-${sessionId.slice(0, 8)}.md`);
    fs.writeFileSync(outFile, md, "utf8");
    console.log(outFile);
  }
}

main();
