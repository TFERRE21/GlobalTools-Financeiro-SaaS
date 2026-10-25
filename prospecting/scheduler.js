import { spawn } from "node:child_process";

const enabled = (process.env.PROSPECT_AUTORUN || "true").toLowerCase() === "true";
const timeZone = "America/Sao_Paulo";
let running = false;
let lastRunLocalDate = "";

function localParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function millisecondsUntilNextMidnight() {
  const now = new Date();
  const parts = localParts(now);
  const todayAtLocalMidnightAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const nextLocalMidnightAsUtc = todayAtLocalMidnightAsUtc + 24 * 60 * 60 * 1000;
  const representedNowAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute)
  );
  const offsetMinutes = (representedNowAsUtc - Math.floor(now.getTime() / 60000) * 60000) / 60000;
  const targetUtc = nextLocalMidnightAsUtc - offsetMinutes * 60 * 1000;
  return Math.max(1000, targetUtc - now.getTime());
}

async function runProspecting() {
  if (running) {
    console.warn("[prospecting] Execução anterior ainda ativa; pulando este ciclo.");
    return;
  }
  if (!process.env.CFO_API_TOKEN || !process.env.RESEND_API_KEY) {
    console.error("[prospecting] Faltam CFO_API_TOKEN ou RESEND_API_KEY; execução ignorada.");
    return;
  }
  running = true;
  const child = spawn(process.execPath, ["prospecting/run.js"], {
    cwd: process.cwd(),
    env: { ...process.env, SEND_EMAILS: "true" },
    stdio: "inherit"
  });
  child.on("error", (error) => {
    console.error("[prospecting] Falha ao iniciar:", error.message);
    running = false;
  });
  child.on("exit", (code, signal) => {
    console.log(`[prospecting] Execução finalizada: code=${code}, signal=${signal || "none"}`);
    running = false;
  });
}

function scheduleNextMidnight() {
  const delay = millisecondsUntilNextMidnight();
  const next = new Date(Date.now() + delay);
  console.log(`[prospecting] Próxima execução agendada para meia-noite de Brasília; em aproximadamente ${Math.round(delay / 60000)} minutos (estimativa ${next.toISOString()}).`);
  setTimeout(async () => {
    const parts = localParts(new Date());
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    if (dateKey !== lastRunLocalDate) {
      lastRunLocalDate = dateKey;
      await runProspecting();
    }
    scheduleNextMidnight();
  }, delay);
}

if (enabled) {
  console.log("[prospecting] VERSAO CAMPANHA IMEDIATA ATIVA: primeira execução em 15 segundos; próximas execuções diariamente à meia-noite, fuso America/Sao_Paulo.");
  setTimeout(() => void runProspecting(), 15_000);
  scheduleNextMidnight();
} else {
  console.log("[prospecting] Agendador desativado por PROSPECT_AUTORUN=false.");
}
