import { spawn } from "node:child_process";

const enabled = (process.env.PROSPECT_AUTORUN || "true").toLowerCase() === "true";
const intervalHours = Math.max(1, Number(process.env.PROSPECT_INTERVAL_HOURS || 24));
let running = false;

async function runProspecting() {
  if (running) {
    console.warn("[prospecting] Execução anterior ainda está ativa; ignorando este ciclo.");
    return;
  }
  if (!process.env.CFO_API_TOKEN || !process.env.RESEND_API_KEY) {
    console.error("[prospecting] Não executado: configure CFO_API_TOKEN e RESEND_API_KEY no ambiente do VPS.");
    return;
  }
  running = true;
  const child = spawn(process.execPath, ["prospecting/run.js"], {
    cwd: process.cwd(),
    env: { ...process.env, SEND_EMAILS: process.env.SEND_EMAILS || "true" },
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

if (enabled) {
  console.log(`[prospecting] Agendador ativo: primeira execução em 15s; depois a cada ${intervalHours}h.`);
  setTimeout(() => {
    void runProspecting();
    setInterval(() => void runProspecting(), intervalHours * 60 * 60 * 1000);
  }, 15_000);
} else {
  console.log("[prospecting] Agendador desativado por PROSPECT_AUTORUN=false.");
}
