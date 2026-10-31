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

const INTERVAL_MS = 24 * 60 * 60 * 1000;
let running = false;
let timer = null;

function scheduleNextRun() {
  if (timer) clearTimeout(timer);
  const nextAt = new Date(Date.now() + INTERVAL_MS);
  console.log(`[prospecting] Próxima execução automática em 24 horas: ${nextAt.toISOString()}.`);
  timer = setTimeout(() => {
    timer = null;
    runProspecting();
  }, INTERVAL_MS);
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
    console.error("[prospecting] Configure as variáveis no ambiente do VPS. O código não ignora os bloqueios de descadastro e duplicidade.");
    scheduleNextRun();
    return;
  }

  running = true;
  console.log("[prospecting] Iniciando execução automática. Limite máximo de 70 e-mails/dia; duplicados e descadastros permanecem bloqueados.");
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

if (missing.length) {
  console.error("[prospecting] Agendador carregado, mas o primeiro envio não será disparado até configurar:", missing.join(", "));
} else {
  console.log("[prospecting] Agendador ativo: execução imediata na inicialização e repetição a cada 24 horas.");
}
runProspecting();
