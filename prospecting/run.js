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
const PLAN_MONTHLY_SEARCH_QUOTA = Math.max(1, Number(env.CFO_MONTHLY_SEARCH_QUOTA || 2000));
const PLAN_MONTHLY_LEAD_QUOTA = Math.max(1, Number(env.CFO_MONTHLY_LEAD_QUOTA || 10000));
const DAILY_SEARCH_BUDGET = Math.floor(PLAN_MONTHLY_SEARCH_QUOTA / 30);
const DAILY_LEAD_BUDGET = Math.floor(PLAN_MONTHLY_LEAD_QUOTA / 30);
const DAILY_LIMIT = Math.min(70, DAILY_LEAD_BUDGET, Math.max(1, Number(env.PROSPECT_DAILY_LIMIT || 70)));
const SEND_EMAILS = env.SEND_EMAILS === "true";
if (SEND_EMAILS && env.PROSPECT_OPT_OUT_READY !== "true") {
  console.error("[prospecting] ENVIO BLOQUEADO: o processamento de respostas SAIR/descadastro ainda precisa ser confirmado.");
  process.exit(1);
}
if (SEND_EMAILS && !env.PROSPECT_REPLY_TO) {
  console.error("[prospecting] ENVIO BLOQUEADO: configure PROSPECT_REPLY_TO com o endereço de recebimento para respostas SAIR.");
  process.exit(1);
}
const STATE_PATH = path.resolve(env.PROSPECT_STATE_PATH || "./data/prospecting-state.json");
const SITE_URL = (env.PUBLIC_SITE_URL || "https://daymoney.com.br").replace(/\/$/, "") + "/";
const CFO_URL = env.CFO_API_URL || "https://cfo.com.br/api";
const cfoQuotaHeaders = {};
const CFO_META_URL = env.CFO_META_URL || "https://cfo.com.br/api?resource=meta";
async function fetchCfoMeta() {
  try {
    const response = await fetch(CFO_META_URL, {
      headers: { Authorization: `Bearer ${env.CFO_API_TOKEN}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { http_status: response.status, error: body?.error?.message || body?.message || "meta indisponível" };
    return body;
  } catch (error) {
    return { error: "meta indisponível: " + String(error.message || error).slice(0, 160) };
  }
}
const RESEND_FROM = env.RESEND_FROM || "Base Financeira <financeiro@oolivo.com.br>";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const asDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const localDateKey = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
function previousBusinessDayKey(now = new Date()) {
  const todayKey = localDateKey(now);
  const cursor = new Date(`${todayKey}T12:00:00Z`);
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  return cursor.toISOString().slice(0, 10);
}
const first = (...values) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
function isContactMasked(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "nao", "não", "no", "n", "off", ""].includes(normalized)) return false;
  if (["true", "1", "sim", "yes", "y", "on"].includes(normalized)) return true;
  // Unknown values must be reviewed rather than treated as proof that contact is revealed.
  return true;
}

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
  // A busca anterior retornou 250 registros com paginação. Mantemos a paginação,
  // deduplicando por CNPJ e encerrando se a API repetir a mesma página.
  const allRows = [];
  const seen = new Set();
  const configuredMaxPages = Math.max(1, Math.min(20, Number(env.CFO_MAX_PAGES || 10)));
  const maxPages = Math.max(1, Math.min(configuredMaxPages, DAILY_SEARCH_BUDGET));
  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      resource: "empresas", dias: String(DAYS), per_page: "100",
      page: String(page), reveal: "1", sit: "2"
    });
    if (env.CFO_UF) params.set("uf", env.CFO_UF);
    if (env.CFO_CNAE) params.set("cnae", env.CFO_CNAE);
    const response = await fetch(`${CFO_URL}?${params}`, {
      headers: { Authorization: `Bearer ${env.CFO_API_TOKEN}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`CFO API retornou HTTP ${response.status} na página ${page}; nenhum envio deve continuar.`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (payload.data || payload.empresas || payload.results || payload.items || []);
    if (!Array.isArray(rows)) throw new Error("Formato inesperado da CFO API; nenhuma mensagem foi enviada.");
    if (rows.length === 0) break;
    let added = 0;
    for (const row of rows) {
      const key = String(first(row.cnpj, row.CNPJ, row.documento, row.numero_cnpj) || JSON.stringify(row));
      if (seen.has(key)) continue;
      seen.add(key);
      allRows.push(row);
      added += 1;
    }
    if (added === 0) break;
    const meta = payload.pagination || payload.meta || {};
    const totalPages = Number(meta.total_pages || meta.last_page || payload.total_pages || 0);
    if (totalPages > 0 && page >= totalPages) break;
    if (rows.length < 25 && totalPages === 0) break;
  }
  return allRows;
}
function mapCompany(row) {
  const cnpj = String(first(row.cnpj, row.CNPJ, row.documento, row.numero_cnpj) || "").replace(/\D/g, "");
  const name = String(first(row.nome_fantasia, row.razao_social, row.nome, row.name) || "").trim();
  const email = normalizeEmail(first(row.contato?.email, row.email, row.email_contato, row.email_comercial, row.contato_email));
  const openedAt = asDate(first(row.data_inicio, row.data_abertura, row.abertura, row.data_inicio_atividade, row.opening_date));
  return { cnpj, name, email, openedAt, source: CFO_URL, emailSource: CFO_URL, contactMasked: isContactMasked(row.contato_mascarado), contactMaskedRawType: row.contato_mascarado === null ? "null" : Array.isArray(row.contato_mascarado) ? "array" : typeof row.contato_mascarado, contactMaskedRaw: row.contato_mascarado };
}
function emailContent(company) {
  const safeName = company.name.replace(/[<>]/g, "").slice(0, 120) || "sua empresa";
  const openedDate = company.openedAt.toISOString().slice(0, 10).split("-").reverse().join("/");
  const site = SITE_URL;
  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GlobalTools Financeiro — controle financeiro para pequenos negócios</title></head>
<body style="margin:0;padding:24px 8px;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#17324a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-collapse:separate;border-spacing:0;border-radius:12px;overflow:hidden;">
<tr><td style="background:#112d46;padding:28px 24px 24px;text-align:center;color:#ffffff;">
<div style="font-size:12px;font-weight:bold;letter-spacing:1.4px;color:#b9f3d3;margin-bottom:16px;">✦ GLOBALTOOLS FINANCEIRO · DAYMONEY</div>
<h1 style="font-size:25px;line-height:1.25;margin:0 0 8px;font-weight:700;color:#ffffff;">Sua empresa começou.<br>Vamos organizar o futuro?</h1>
<p style="font-size:13px;margin:0;color:#e6edf4;">Parabéns por essa nova conquista! 🎉</p>
</td></tr>
<tr><td style="padding:28px 28px 24px;font-size:14px;line-height:1.7;color:#40556a;">
<p style="margin:0 0 14px;">Olá, empreendedor(a) da <strong style="color:#17324a;">${safeName}</strong>!</p>
<p style="margin:0 0 14px;">Abrir uma empresa é um passo importante. Desde o primeiro dia, cuidar do dinheiro que entra e sai ajuda você a tomar decisões com mais clareza e confiança.</p>
<p style="margin:0 0 22px;">O <strong style="color:#17324a;">GlobalTools Financeiro</strong> (marca comercial DayMoney) foi pensado para ajudar pequenos negócios a organizar receitas, despesas e fluxo de caixa.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr><td width="38" valign="top" style="padding:0 0 16px;font-size:20px;">📊</td><td style="padding:0 0 16px;"><strong style="display:block;color:#17324a;font-size:14px;">Acompanhe receitas e despesas</strong><span style="font-size:12px;color:#718096;">Tenha uma visão mais clara das movimentações do negócio.</span></td></tr>
<tr><td width="38" valign="top" style="padding:0 0 16px;font-size:20px;">🗓️</td><td style="padding:0 0 16px;"><strong style="display:block;color:#17324a;font-size:14px;">Organize o fluxo de caixa</strong><span style="font-size:12px;color:#718096;">Planeje pagamentos e acompanhe o saldo com mais praticidade.</span></td></tr>
<tr><td width="38" valign="top" style="padding:0 0 20px;font-size:20px;">🧭</td><td style="padding:0 0 20px;"><strong style="display:block;color:#17324a;font-size:14px;">Decida com mais segurança</strong><span style="font-size:12px;color:#718096;">Use informações organizadas como apoio à gestão da empresa.</span></td></tr>
</table>
<div style="text-align:center;padding:2px 0 18px;"><a href="${site}" style="display:inline-block;background:#07835f;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:14px 22px;border-radius:5px;">Conhecer o GlobalTools Financeiro →</a></div>
<p style="text-align:center;margin:0;color:#8190a0;font-size:11px;">Organização hoje. Mais clareza para crescer amanhã.</p>
</td></tr>
<tr><td style="background:#f7f9fa;border-top:1px solid #e4e9ed;padding:16px 22px;text-align:center;color:#82909d;font-size:10px;line-height:1.6;">Esta mensagem comercial foi enviada pela equipe do GlobalTools Financeiro (marca comercial DayMoney) porque uma fonte empresarial pública indica abertura recente de ${safeName} em ${openedDate}. Para não receber novas mensagens, responda <strong>SAIR</strong>.<br><br>Remetente: Base Financeira &lt;financeiro@oolivo.com.br&gt;.</td></tr>
</table>
</body></html>`;
  const text = `GLOBALTOOLS FINANCEIRO · DAYMONEY

Sua empresa começou. Vamos organizar o futuro?
Parabéns por essa nova conquista!

Olá, empreendedor(a) da ${safeName}!

Abrir uma empresa é um passo importante. Desde o primeiro dia, cuidar do dinheiro que entra e sai ajuda você a tomar decisões com mais clareza e confiança.

O GlobalTools Financeiro (marca comercial DayMoney) foi pensado para ajudar pequenos negócios a organizar receitas, despesas e fluxo de caixa.

📊 Acompanhe receitas e despesas
Tenha uma visão mais clara das movimentações do negócio.

🗓️ Organize o fluxo de caixa
Planeje pagamentos e acompanhe o saldo com mais praticidade.

🧭 Decida com mais segurança
Use informações organizadas como apoio à gestão da empresa.

Conhecer o GlobalTools Financeiro: ${site}

Organização hoje. Mais clareza para crescer amanhã.

Esta mensagem comercial foi enviada pela equipe do GlobalTools Financeiro (marca comercial DayMoney) porque uma fonte empresarial pública indica abertura recente de ${safeName} em ${openedDate}. Para não receber novas mensagens, responda SAIR.

Remetente: Base Financeira <financeiro@oolivo.com.br>.`;
  return { subject: "Sua empresa começou. Vamos organizar o futuro?", html, text };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PERSONAL_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.br", "outlook.com",
  "outlook.com.br", "live.com", "live.com.br", "yahoo.com", "yahoo.com.br",
  "icloud.com", "me.com", "protonmail.com", "proton.me", "aol.com", "bol.com.br",
  "uol.com.br", "terra.com.br"
]);
function isPersonalMailbox(email) {
  const domain = normalizeEmail(email).split("@")[1] || "";
  return PERSONAL_MAIL_DOMAINS.has(domain);
}

async function fetchResendCollection(resource) {
  const all = [];
  let after = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://api.resend.com/" + resource);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error("Resend preflight GET /" + resource + " falhou com HTTP " + response.status + "; nenhum envio foi iniciado.");
    const payload = await response.json();
    const batch = Array.isArray(payload.data) ? payload.data : [];
    all.push(...batch);
    if (batch.length === 0 || payload.has_more === false) return all;
    if (payload.has_more !== true) {
      if (batch.length < 100) return all;
      throw new Error("Paginação de /" + resource + " ambígua; nenhum envio foi iniciado.");
    }
    const next = batch[batch.length - 1]?.id;
    if (!next || next === after) throw new Error("Paginação de /" + resource + " inconclusiva; nenhum envio foi iniciado.");
    after = next;
  }
  throw new Error("O histórico de /" + resource + " excede o limite de segurança da verificação; nenhum envio foi iniciado.");
}

async function loadResendSafetyState() {
  const results = await Promise.all([
    fetchResendCollection("emails"),
    fetchResendCollection("suppressions")
  ]);
  const history = results[0];
  const suppressions = results[1];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentIssues = history.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    const createdAt = Date.parse(item.created_at || item.createdAt || "");
    const recent = !Number.isFinite(createdAt) || createdAt >= cutoff;
    return recent && ["failed", "bounced", "complained", "suppressed"].includes(status);
  });
  const recentBadSuppressions = suppressions.filter((item) => {
    const origin = String(item.origin || "").toLowerCase();
    const createdAt = Date.parse(item.created_at || "");
    return ["bounce", "complaint"].includes(origin) && (!Number.isFinite(createdAt) || createdAt >= cutoff);
  });
  if (SEND_EMAILS && (recentIssues.length > 0 || recentBadSuppressions.length > 0)) {
    throw new Error("Envio pausado: o histórico recente do Resend contém " + recentIssues.length + " mensagem(ns) com falha/bounce/reclamação e " + recentBadSuppressions.length + " supressão(ões) recente(s) por bounce/reclamação.");
  }
  const previouslySent = new Set();
  for (const item of history) {
    const recipients = Array.isArray(item.to) ? item.to : (item.to ? [item.to] : []);
    for (const recipient of recipients) {
      previouslySent.add(normalizeEmail(typeof recipient === "string" ? recipient : recipient?.email));
    }
  }
  const suppressed = new Set(suppressions.map((item) => normalizeEmail(item.email || item.address)).filter(Boolean));
  return { history, previouslySent, suppressed, recentIssues: recentIssues.length, recentBadSuppressions: recentBadSuppressions.length };
}


async function sendEmail(to, content) {
  // Envia em ritmo conservador para não atingir o limite de requisições do Resend.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sleep(10_000);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": "prospect-" + normalizeEmail(to).replace(/[^a-z0-9]/g, "-") },
      body: JSON.stringify({ from: RESEND_FROM, reply_to: env.PROSPECT_REPLY_TO, to: [to], subject: content.subject, html: content.html, text: content.text }),
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
state.sent ||= {};
state.suppressed ||= {};
state.lastRun = new Date().toISOString();
const resendSafety = await loadResendSafetyState();
if (resendSafety.recentIssues || resendSafety.recentBadSuppressions) {
  console.warn("[prospecting] ALERTA: " + resendSafety.recentIssues + " falha(s) recente(s) e " + resendSafety.recentBadSuppressions + " supressão(ões) recente(s); o envio fica bloqueado até revisão.");
}
const cfoMeta = await fetchCfoMeta();
const usage = cfoMeta?.account?.usage_this_month || {};
const searchRemaining = Number(usage.remaining ?? cfoMeta?.account?.limits?.monthly_quota);
const leadsRemaining = Number(usage.leads_remaining ?? cfoMeta?.account?.limits?.lead_quota);
let quotaPauseReason = "";
if (cfoMeta?.http_status && cfoMeta.http_status !== 200) {
  quotaPauseReason = "CFO_META_UNAVAILABLE";
} else if (Number.isFinite(searchRemaining) && searchRemaining <= 0) {
  quotaPauseReason = "CFO_MONTHLY_SEARCH_QUOTA_EXHAUSTED";
} else if (Number.isFinite(leadsRemaining) && leadsRemaining <= 0) {
  quotaPauseReason = "CFO_MONTHLY_LEAD_QUOTA_EXHAUSTED";
}
const rows = quotaPauseReason ? [] : await fetchCompanies();
const today = localDateKey(new Date());
const targetOpeningDate = previousBusinessDayKey(new Date());
const requestedTargetDates = String(env.PROSPECT_TARGET_DATES || "").split(",").map((value) => value.trim()).filter((value) => value.length === 10 && value[4] === "-" && value[7] === "-" && !Number.isNaN(Date.parse(value + "T12:00:00Z")));
const backfillDays = Math.max(0, Math.min(31, Number(env.PROSPECT_BACKFILL_DAYS ?? 31)));
const targetOpeningDates = new Set(requestedTargetDates.length ? requestedTargetDates : backfillDays > 0 ? Array.from({ length: backfillDays + 1 }, (_, i) => { const d = new Date(localDateKey(new Date()) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - i); return d.toISOString().slice(0, 10); }) : [targetOpeningDate]);
const sentToday = Object.values(state.sent).filter((item) => item.sentAt && !Number.isNaN(Date.parse(item.sentAt)) && localDateKey(new Date(item.sentAt)) === today).length;
const remainingToday = Math.max(0, DAILY_LIMIT - sentToday);
const legacyPreviouslySent = new Set([
  "isaquemoreira.castelan@gmail.com",
  "rodri.luke28@gmail.com",
  "lourivalsilvestre194@gmail.com",
  "vanessapedroso27@hotmail.com",
  "abertura@maismei.com.br",
  "tembicos@gmail.com",
  "skauanbr@gmail.com",
  "vitorobrito13@gmail.com",
  "gabettigiovanna6@gmail.com",
  "gb81091@gmail.com"
].map(normalizeEmail));
const knownSentEmails = new Set([
  ...legacyPreviouslySent,
  ...resendSafety.previouslySent,
  ...Object.keys(state.sent).map(normalizeEmail)
]);
const knownSuppressedEmails = new Set([
  ...resendSafety.suppressed,
  ...Object.keys(state.suppressed).map(normalizeEmail)
]);
const knownSentCnpjs = new Set(Object.values(state.sent).map((item) => String(item.cnpj || "")));
const seenEmails = new Set();
const seenCnpjs = new Set();
const filterCounts = { invalid_data: 0, personal_email: 0, already_sent_or_suppressed: 0, opening_date_outside_target: 0, duplicate_in_batch: 0, eligible_before_limit: 0 };
const invalidReasons = { cnpj_missing_or_invalid: 0, name_missing: 0, email_missing_or_invalid: 0, opening_date_missing_or_invalid: 0, contact_masked: 0 };
const invalidExamples = [];
const contactMaskValues = {};
const mappedRows = rows.map((row) => {
  const mapped = mapCompany(row);
  const raw = row.contato_mascarado;
  const key = raw === null ? "null" : raw === undefined ? "undefined" : `${typeof raw}:${String(raw).trim().toLowerCase().slice(0, 24)}`;
  contactMaskValues[key] = (contactMaskValues[key] || 0) + 1;
  return mapped;
});
const filteredCandidates = mappedRows.filter((c, index) => {
  c.email = normalizeEmail(c.email);
  const reasons = [];
  if (!c.cnpj || c.cnpj.length !== 14) reasons.push("cnpj_missing_or_invalid");
  if (!c.name) reasons.push("name_missing");
  if (!validEmail(c.email)) reasons.push("email_missing_or_invalid");
  if (!c.openedAt) reasons.push("opening_date_missing_or_invalid");
  if (c.contactMasked) reasons.push("contact_masked");
  if (reasons.length) {
    filterCounts.invalid_data++;
    for (const reason of reasons) invalidReasons[reason]++;
    if (invalidExamples.length < 8) {
      const raw = rows[index] || {};
      invalidExamples.push({ fields: Object.keys(raw), reasons });
    }
    return false;
  }
  // Não descartar contato válido apenas porque usa Gmail/Hotmail; duplicidade e descadastro seguem bloqueados.
  if (knownSentEmails.has(c.email) || knownSuppressedEmails.has(c.email) || knownSentCnpjs.has(c.cnpj)) { filterCounts.already_sent_or_suppressed++; return false; }
  // Por padrão processa o dia útil imediatamente anterior. Para uma busca retroativa pontual,
  // PROSPECT_TARGET_DATES aceita datas YYYY-MM-DD separadas por vírgula.
  if (!targetOpeningDates.has(localDateKey(c.openedAt))) { filterCounts.opening_date_outside_target++; return false; }
  if (seenEmails.has(c.email) || seenCnpjs.has(c.cnpj)) { filterCounts.duplicate_in_batch++; return false; }
  seenEmails.add(c.email);
  seenCnpjs.add(c.cnpj);
  return true;
});
filterCounts.eligible_before_limit = filteredCandidates.length;
const candidates = filteredCandidates.slice(0, remainingToday);

console.log(JSON.stringify({ mode: SEND_EMAILS ? "SEND" : "DRY_RUN", source: CFO_URL, target_opening_dates: [...targetOpeningDates], target_opening_date: targetOpeningDate, companies_found: rows.length, cfo_quota_headers: cfoQuotaHeaders, cfo_meta: cfoMeta, quota_pause_reason: quotaPauseReason || null, plan_daily_budgets: { searches: DAILY_SEARCH_BUDGET, leads: DAILY_LEAD_BUDGET, email_send_limit: DAILY_LIMIT, max_search_pages_this_run: Math.max(1, Math.min(Math.max(1, Math.min(20, Number(env.CFO_MAX_PAGES || 10))), DAILY_SEARCH_BUDGET)) }, filter_counts: filterCounts, invalid_reasons: invalidReasons, contact_mask_values: contactMaskValues, invalid_examples: invalidExamples, eligible: candidates.length, daily_limit: DAILY_LIMIT, sent_today_before_run: sentToday, remaining_today_before_run: remainingToday }, null, 2));
let sent = 0;
for (const company of candidates) {
  console.log(`CANDIDATE ${JSON.stringify({ name: company.name, cnpj: company.cnpj, openedAt: company.openedAt.toISOString().slice(0, 10), email: company.email, source: company.source, emailSource: company.emailSource || company.source })}`);
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
console.log(JSON.stringify({ mode: SEND_EMAILS ? "SEND" : "DRY_RUN", target_opening_dates: [...targetOpeningDates], target_opening_date: targetOpeningDate, eligible: candidates.length, sent, daily_limit: DAILY_LIMIT, sent_today_total: sentToday + sent, state_file: STATE_PATH }, null, 2));
