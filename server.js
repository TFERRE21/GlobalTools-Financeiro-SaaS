import http from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./prospecting/scheduler.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  if (requestUrl.pathname === "/api/status" && req.method === "GET") {
    return json(res, 200, { ok: true, checkout: Boolean(process.env.STRIPE_SECRET_KEY), service: "globaltools-financeiro-saas" });
  }

  if (requestUrl.pathname === "/api/planilha-checkout" && req.method === "POST") {
    try {
      if (!process.env.STRIPE_SECRET_KEY) return json(res, 503, { error: "Checkout ainda não configurado no VPS. Configure STRIPE_SECRET_KEY no ambiente do servidor." });
      const filePath = path.join(root, "downloads", "Controle_Financeiro_Preview.xlsx");
      if (!await stat(filePath).then(() => true).catch(() => false)) return json(res, 503, { error: "A planilha ainda está sendo publicada. Nenhuma cobrança foi iniciada." });
      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("line_items[0][price]", "price_1UUHdSCCSBhBJictzwSLvlal");
      form.set("line_items[0][quantity]", "1");
      form.set("success_url", siteUrl(req) + "/obrigado-planilha.html?session_id={CHECKOUT_SESSION_ID}");
      form.set("cancel_url", siteUrl(req) + "/#planilha");
      form.set("metadata[product]", "controle_financeiro_excel");
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
      const data = await response.json();
      if (!response.ok || !data.url) {
        console.error("[stripe] Checkout da planilha falhou", { status: response.status, code: data?.error?.code });
        return json(res, 502, { error: "O Stripe não conseguiu iniciar o pagamento. Tente novamente." });
      }
      return json(res, 200, { url: data.url });
    } catch (error) {
      console.error("[stripe] Erro ao criar checkout da planilha:", error.message);
      return json(res, 500, { error: "Erro interno ao preparar o pagamento." });
    }
  }

  if (requestUrl.pathname === "/api/planilha-entregar" && req.method === "POST") {
    try {
      if (!process.env.STRIPE_SECRET_KEY) return json(res, 503, { error: "Validação de pagamento indisponível." });
      if (!process.env.RESEND_API_KEY) return json(res, 503, { error: "Envio de e-mail ainda não está configurado no servidor." });
      const body = await readRequestJson(req);
      const sessionId = String(body.session_id || "");
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json(res, 400, { error: "Sessão de pagamento inválida." });
      const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), { headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY } });
      const session = await stripeResponse.json();
      if (!stripeResponse.ok || session.payment_status !== "paid" || session.mode !== "payment" || session.amount_total !== 2000 || session.currency !== "brl" || session.metadata?.product !== "controle_financeiro_excel") {
        return json(res, 403, { error: "Pagamento ainda não confirmado para esta planilha." });
      }
      const email = session.customer_details?.email || session.customer_email;
      if (!email) return json(res, 400, { error: "O Stripe não retornou um e-mail para esta compra." });
      const quotaPath = path.join(root, ".planilha-email-quota.json");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      let quota = { date: today, sessions: [] };
      try {
        const savedQuota = JSON.parse(await readFile(quotaPath, "utf8"));
        if (savedQuota.date === today && Array.isArray(savedQuota.sessions)) quota = savedQuota;
      } catch {}
      if (quota.sessions.includes(session.id)) return json(res, 200, { ok: true, message: "Esta compra já teve o envio processado." });
      if (quota.sessions.length >= 60) return json(res, 429, { error: "Limite diário de envios da planilha atingido. O envio será retomado no próximo dia; entre em contato com o suporte se precisar do arquivo antes." });
      const file = await readFile(path.join(root, "downloads", "Controle_Financeiro_Preview.xlsx"));
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": "planilha-" + session.id },
        body: JSON.stringify({
          from: process.env.PLANILHA_EMAIL_FROM || "Base Financeira <financeiro@oolivo.com.br>",
          to: [email],
          subject: "Sua Planilha Base Financeira está pronta",
          text: "Obrigado pela compra! Segue em anexo sua Planilha Base Financeira em Excel. Guarde este e-mail para consultar o arquivo novamente.",
          html: "<div style=\"font-family:Arial,sans-serif;color:#142d4e;max-width:600px;margin:auto\"><h2>Obrigado pela compra!</h2><p>Seu pagamento foi confirmado. A Planilha Base Financeira está anexada a este e-mail.</p><p>O arquivo inclui painel financeiro, lançamentos e gráficos para organizar receitas e despesas.</p><p>Atenciosamente,<br><strong>Base Financeira</strong></p></div>",
          attachments: [{ filename: "Controle_Financeiro_Base_Financeira.xlsx", content: file.toString("base64") }]
        })
      });
      const resendData = await resendResponse.json();
      if (!resendResponse.ok) {
        console.error("[delivery] Resend falhou", { status: resendResponse.status, message: resendData?.message || resendData?.name });
        return json(res, 502, { error: "Pagamento confirmado, mas o e-mail não foi enviado. Use o botão de download ou tente novamente." });
      }
      quota.sessions.push(session.id);
      try { await writeFile(quotaPath, JSON.stringify(quota, null, 2), { mode: 0o600 }); }
      catch (quotaError) { console.error("[delivery] Não foi possível salvar a cota diária:", quotaError.message); }
      return json(res, 200, { ok: true, message: "Planilha enviada para o e-mail usado na compra." });
    } catch (error) {
      console.error("[delivery] Envio automático falhou:", error.message);
      return json(res, 500, { error: "Não foi possível enviar a planilha agora." });
    }
  }

  if (requestUrl.pathname === "/api/planilha-download" && req.method === "GET") {
    try {
      if (!process.env.STRIPE_SECRET_KEY) return json(res, 503, { error: "Entrega temporariamente indisponível." });
      const sessionId = requestUrl.searchParams.get("session_id") || "";
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json(res, 400, { error: "Sessão de pagamento inválida." });
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), { headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY } });
      const session = await response.json();
      if (!response.ok || session.payment_status !== "paid" || session.mode !== "payment" || session.amount_total !== 2000 || session.currency !== "brl" || session.metadata?.product !== "controle_financeiro_excel") {
        return json(res, 403, { error: "Pagamento ainda não confirmado ou sessão não corresponde à planilha." });
      }
      const file = await readFile(path.join(root, "downloads", "Controle_Financeiro_Preview.xlsx"));
      res.writeHead(200, { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-length": file.length, "content-disposition": 'attachment; filename="Controle_Financeiro_Preview.xlsx"', "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(file);
    } catch (error) {
      console.error("[delivery] Download da planilha indisponível:", error.message);
      return json(res, 503, { error: "Arquivo temporariamente indisponível. Entre em contato com o suporte." });
    }
    return;
  }


  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "globaltools-financeiro-saas" }));
    return;
  }

  try {
    const url = new URL(req.url || "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const target = path.resolve(root, "." + pathname);

    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": types[path.extname(target).toLowerCase()] || "application/octet-stream",
      "content-length": body.length,
      "x-content-type-options": "nosniff"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});



async function readRequestJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new Error("Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function siteUrl(req) {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return proto + "://" + host;
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

server.listen(port, "0.0.0.0", () => {
  console.log(`GlobalTools Financeiro SaaS listening on 0.0.0.0:${port}`);
});
