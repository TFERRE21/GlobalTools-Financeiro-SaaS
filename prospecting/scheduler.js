import { spawn } from "node:child_process";

const REQUIRED_FLAGS = [
  ["PROSPECT_AUTORUN", (value) => value === "true"],
  ["PROSPECT_ACK_DUPLICATE_GUARD", (value) => value === "true"],
  ["PROSPECT_OPT_OUT_READY", (value) => value === "true"],
  ["PROSPECT_REPLY_TO", Boolean],
  ["RESEND_WEBHOOK_SECRET", Boolean],
  ["CFO_API_TOKEN", Boolean],
  ["RESEND_API_KEY", Boolean]
];
const missing = REQUIRED_FLAGS
  .filter(([key, valid]) => !valid(process.env[key] || ""))
  .map(([key]) => key);

const TIME_ZONE = "America/Sao_Paulo";
let running = false;
let timer = null;

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function offsetAt(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - timestamp;
}

function nextEightAmBrasilia() {
  const now = new Date();
  const today = zonedParts(now);
  // Build tomorrow's calendar date in Brasília, independent of the VPS timezone.
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const year = tomorrow.getUTCFullYear();
  const month = tomorrow.getUTCMonth();
  const day = tomorrow.getUTCDate();
  const localTargetAsUtc = Date.UTC(year, month, day, 8, 0, 0);
  let target = localTargetAsUtc - offsetAt(localTargetAsUtc);
  if (target <= now.getTime()) {
    const following = new Date(Date.UTC(year, month, day + 1));
    const nextLocalTarget = Date.UTC(following.getUTCFullYear(), following.getUTCMonth(), following.getUTCDate(), 8, 0, 0);
    target = nextLocalTarget - offsetAt(nextLocalTarget);
  }
  return new Date(target);
}

function scheduleNextRun() {
  if (timer) clearTimeout(timer);
  const nextAt = nextEightAmBrasilia();
  const delay = Math.max(1000, nextAt.getTime() - Date.now());
  console.log(`[prospecting] Próxima execução programada: 08:00 (Brasília), em ${nextAt.toISOString()}.`);
  timer = setTimeout(() => {
    timer = null;
    runProspecting();
  }, delay);
  timer.unref?.();
}

function runProspecting() {
  if (running) {
    console.warn("[prospecting] Execução anterior ainda ativa; este ciclo será ignorado.");
    scheduleNextRun();
    return;
  }
  if (missing.length) {
    console.error("[prospecting] ENVIO AUTOMÁTICO PAUSADO. Variáveis ausentes ou não habilitadas:", missing.join(", "));
    console.error("[prospecting] Configure as variáveis indicadas no ambiente do VPS. Os bloqueios de descadastro e duplicidade continuam ativos.");
    scheduleNextRun();
    return;
  }

  running = true;
  console.log("[prospecting] Iniciando envio. Limite máximo de 70 e-mails/dia; duplicados e descadastros permanecem bloqueados.");
  const child = spawn(process.execPath, ["prospecting/run.js"], {
    cwd: process.cwd(),
    env: { ...process.env, SEND_EMAILS: "true", PROSPECT_DAILY_LIMIT: "70" },
    stdio: "inherit"
  });

  child.on("error", (error) => {
    console.error("[prospecting] Falha ao iniciar o processo:", error.message);
    running = false;
    scheduleNextRun();
  });
  child.on("exit", (code, signal) => {
    console.log(`[prospecting] Execução finalizada: code=${code}, signal=${signal || "none"}.`);
    running = false;
    scheduleNextRun();
  });
}

console.log("[prospecting] Agendador carregado: primeira tentativa imediata; próximas execuções diariamente às 08:00, horário de Brasília.");
runProspecting();
