import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const env = process.env;
const required = ["CFO_API_TOKEN", "RESEND_API_KEY"];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
  console.error("Configuração ausente:", missing.join(", "));
  process.exit(1);
}

const DAYS = Math.max(1, Number(env.PROSPECT_DAYS || 60));
const DAILY_LIMIT = Math.min(80, Math.max(1, Number(env.PROSPECT_DAILY_LIMIT || 80)));
const SEND_EMAILS = env.SEND_EMAILS === "true";
const STATE_PATH = path.resolve(env.PROSPECT_STATE_PATH || "./data/prospecting-state.json");
const SITE_URL = (env.PRODUCT_URL || "https://globaltoolsfinanceirosaas.vps11710.panel.icontainer.work/").replace(/\/$/, "");
const CFO_URL = env.CFO_API_URL || "https://cfo.com.br/api";
const RESEND_FROM = env.RESEND_FROM || "Base Financeira <financeiro@oolivo.com.br>";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const asDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const first = (...values) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== "");

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { sent: {}, suppressed: {}, lastRun: null };
  }
}
async function saveState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}
async function fetchCompanies() {
  const params = new URLSearchParams({
    resource: "empresas",
    dias: String(DAYS),
    per_page: "100",
    reveal: "1",
    sit: "2"
  });
  if (env.CFO_UF) params.set("uf", env.CFO_UF);
  if (env.CFO_CNAE) params.set("cnae", env.CFO_CNAE);
  const response = await fetch(`${CFO_URL}?${params}`, {
    headers: { Authorization: `Bearer ${env.CFO_API_TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`CFO API retornou HTTP ${response.status}; verifique chave/plano e CFO_API_URL.`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : (payload.data || payload.empresas || payload.results || payload.items || []);
  if (!Array.isArray(rows)) throw new Error("Formato inesperado da CFO API; nenhuma mensagem foi enviada.");
  return rows;
}
function mapCompany(row) {
  const cnpj = String(first(row.cnpj, row.CNPJ, row.documento, row.numero_cnpj) || "").replace(/\D/g, "");
  const name = String(first(row.nome_fantasia, row.razao_social, row.nome, row.name) || "").trim();
  const email = normalizeEmail(first(row.contato?.email, row.email, row.email_contato, row.email_comercial, row.contato_email));
  const openedAt = asDate(first(row.data_inicio, row.data_abertura, row.abertura, row.data_inicio_atividade, row.opening_date));
  return { cnpj, name, email, openedAt, source: CFO_URL, contactMasked: Boolean(row.contato_mascarado) };
}
function emailContent(company) {
  const safeName = company.name.replace(/[<>]/g, "").slice(0, 120) || "equipe";
  return {
    subject: `Uma ideia para organizar o financeiro da ${safeName}`,
    html: `<p>Olá, equipe da <strong>${safeName}</strong>.</p>
<p>Estamos apresentando o GlobalTools Financeiro, uma ferramenta para ajudar pequenas empresas a organizar entradas, despesas e acompanhar o saldo financeiro.</p>
<p>Você pode conhecer a proposta aqui: <a href="${SITE_URL}">${SITE_URL}</a></p>
<p>Esta é uma mensagem comercial enviada para um contato empresarial publicado. Se não quiser receber novos contatos, responda a este e-mail com <strong>SAIR</strong>; seu endereço será incluído na lista de supressão.</p>
<p>Atenciosamente,<br>Equipe GlobalTools</p>`,
    text: `Olá, equipe da ${safeName}.\n\nEstamos apresentando o GlobalTools Financeiro, uma ferramenta para organizar entradas, despesas e acompanhar o saldo financeiro.\n\nConheça: ${SITE_URL}\n\nEsta é uma mensagem comercial. Se não quiser receber novos contatos, responda com SAIR para inclusão na lista de supressão.\n\nEquipe GlobalTools`
  };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendEmail(to, content) {
  // Envia em ritmo conservador para não atingir o limite de requisições do Resend.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sleep(1200);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject: content.subject, html: content.html, text: content.text }),
      signal: AbortSignal.timeout(30000)
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body.id;
    if (response.status === 429 && attempt < 3) {
      const waitMs = Math.min(30000, 2000 * (2 ** attempt));
      console.warn(`RATE_LIMIT: Resend limitou o envio; aguardando ${waitMs}ms antes de tentar novamente.`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Resend HTTP ${response.status}: ${body.message || body.name || "falha no envio"}`);
  }
  throw new Error("Resend continuou limitando as requisições após novas tentativas.");
}

const state = await readState();
state.lastRun = new Date().toISOString();
const rows = await fetchCompanies();
const today = new Date().toISOString().slice(0, 10);
const sentToday = Object.values(state.sent).filter((item) => String(item.sentAt || "").slice(0, 10) === today).length;
const remainingToday = Math.max(0, DAILY_LIMIT - sentToday);
const candidates = rows.map(mapCompany).filter((c) => {
  if (!c.cnpj || c.cnpj.length !== 14 || !c.name || !validEmail(c.email) || !c.openedAt || c.contactMasked) return false;
  const ageDays = (Date.now() - c.openedAt.getTime()) / 86400000;
  return ageDays >= 0 && ageDays <= DAYS && !state.sent[c.email] && !state.suppressed[c.email];
}).slice(0, remainingToday);

console.log(JSON.stringify({ mode: SEND_EMAILS ? "SEND" : "DRY_RUN", source: CFO_URL, companies_found: rows.length, eligible: candidates.length, daily_limit: DAILY_LIMIT, sent_today_before_run: sentToday, remaining_today_before_run: remainingToday }, null, 2));
let sent = 0;
for (const company of candidates) {
  console.log(`CANDIDATE ${JSON.stringify({ name: company.name, cnpj: company.cnpj, openedAt: company.openedAt.toISOString().slice(0, 10), email: company.email, source: company.source })}`);
  if (!SEND_EMAILS) continue;
  try {
    const id = await sendEmail(company.email, emailContent(company));
    state.sent[company.email] = { id, cnpj: company.cnpj, name: company.name, sentAt: new Date().toISOString(), source: company.source };
    await saveState(state);
    sent += 1;
    console.log(`SENT ${company.email} id=${id}`);
  } catch (error) {
    console.error(`STOP: envio falhou para ${company.email}: ${error.message}`);
    await saveState(state);
    process.exitCode = 1;
    break;
  }
}
await saveState(state);
console.log(JSON.stringify({ mode: SEND_EMAILS ? "SEND" : "DRY_RUN", eligible: candidates.length, sent, daily_limit: DAILY_LIMIT, sent_today_total: sentToday + sent, state_file: STATE_PATH }, null, 2));
