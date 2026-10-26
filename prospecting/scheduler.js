import { spawn } from "node:child_process";

const enabled = process.env.PROSPECT_AUTORUN === "true" && process.env.PROSPECT_ACK_DUPLICATE_GUARD === "true" && process.env.PROSPECT_OPT_OUT_READY === "true" && Boolean(process.env.PROSPECT_REPLY_TO) && Boolean(process.env.RESEND_WEBHOOK_SECRET);
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

function millisecondsUntilNextRun() {
  const now = new Date();
  const parts = localParts(now);
  const todayAtLocalMidnightAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const representedNowAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute)
  );
  const targetHour = 0;
  const targetTodayAsUtc = todayAtLocalMidnightAsUtc + targetHour * 60 * 60 * 1000;
  const nextLocalTargetAsUtc = representedNowAsUtc < targetTodayAsUtc
    ? targetTodayAsUtc
    : targetTodayAsUtc + 24 * 60 * 60 * 1000;
  const offsetMinutes = (representedNowAsUtc - Math.floor(now.getTime() / 60000) * 60000) / 60000;
  const targetUtc = nextLocalTargetAsUtc - offsetMinutes * 60 * 1000;
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

function scheduleNextRun() {
  const delay = millisecondsUntilNextRun();
  const next = new Date(Date.now() + delay);
  console.log(`[prospecting] Próxima execução agendada para 00h (meia-noite) de Brasília; em aproximadamente ${Math.round(delay / 60000)} minutos (estimativa ${next.toISOString()}).`);
  setTimeout(async () => {
    const parts = localParts(new Date());
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    if (dateKey !== lastRunLocalDate) {
      lastRunLocalDate = dateKey;
      await runProspecting();
    }
    scheduleNextRun();
  }, delay);
}

if (enabled) {
  console.log("[prospecting] Agendador ativo: execução diária à meia-noite de Brasília. Não haverá envio imediato na inicialização/reinicialização do servidor.");
  scheduleNextRun();
} else {
  console.log("[prospecting] Agendador pausado por segurança. Exige as três confirmações, PROSPECT_REPLY_TO e RESEND_WEBHOOK_SECRET configurados; teste o recebimento de SAIR antes de ativar.");
}
