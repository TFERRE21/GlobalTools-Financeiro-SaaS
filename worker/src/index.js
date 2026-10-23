const STRIPE_API = "https://api.stripe.com/v1";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://tferre21.github.io";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin) });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "globaltools-financeiro-billing", billingEnabled: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID) }, 200, origin, allowedOrigin);
    }

    if (origin && origin !== allowedOrigin) {
      return json({ error: "Origem não autorizada." }, 403, origin, allowedOrigin);
    }

    if (url.pathname === "/api/create-checkout-session" && request.method === "POST") {
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID || !env.PUBLIC_SITE_URL) {
        return json({ error: "Checkout ainda não configurado." }, 503, origin, allowedOrigin);
      }
      let body;
      try { body = await request.json(); } catch {
        return json({ error: "Corpo JSON inválido." }, 400, origin, allowedOrigin);
      }
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "E-mail inválido." }, 400, origin, allowedOrigin);
      }

      const form = new URLSearchParams();
      form.set("mode", "subscription");
      form.set("line_items[0][price]", env.STRIPE_PRICE_ID);
      form.set("line_items[0][quantity]", "1");
      form.set("success_url", env.PUBLIC_SITE_URL + "?checkout=success");
      form.set("cancel_url", env.PUBLIC_SITE_URL + "?checkout=cancelled");
      form.set("allow_promotion_codes", "true");
      if (email) form.set("customer_email", email);
      form.set("metadata[product]", "GlobalTools Financeiro");
      form.set("subscription_data[metadata][product]", "GlobalTools Financeiro");

      const stripeResponse = await fetch(STRIPE_API + "/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      });
      const result = await stripeResponse.json();
      if (!stripeResponse.ok || !result.url) {
        console.error("Stripe Checkout session creation failed", { status: stripeResponse.status, type: result?.error?.type, code: result?.error?.code });
        return json({ error: "Não foi possível iniciar o checkout. Tente novamente mais tarde." }, 502, origin, allowedOrigin);
      }
      return json({ url: result.url }, 200, origin, allowedOrigin);
    }

    if (url.pathname === "/api/stripe-webhook" && request.method === "POST") {
      if (!env.STRIPE_WEBHOOK_SECRET) return new Response("Webhook não configurado", { status: 503 });
      const rawBody = await request.text();
      const signature = request.headers.get("Stripe-Signature") || "";
      const verified = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
      if (!verified) return new Response("Assinatura inválida", { status: 400 });

      let event;
      try { event = JSON.parse(rawBody); } catch { return new Response("JSON inválido", { status: 400 }); }

      // TODO antes de produção: persistir eventos com idempotência e sincronizar o status
      // da assinatura em um banco de dados; nunca conceder acesso com base apenas no
      // redirect success_url. Eventos relevantes incluem checkout.session.completed,
      // customer.subscription.updated/deleted e invoice.payment_failed/paid.
      console.log("Stripe webhook received", { id: event.id, type: event.type });
      return new Response("ok", { status: 200 });
    }

    return json({ error: "Rota não encontrada." }, 404, origin, allowedOrigin);
  }
};

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin === allowedOrigin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin, allowedOrigin) }
  });
}

async function verifyStripeSignature(payload, header, secret) {
  const parts = header.split(",").map(part => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + payload));
  const expected = Array.from(new Uint8Array(signed), b => b.toString(16).padStart(2, "0")).join("");
  return signatures.some(signature => constantTimeEqual(signature, expected));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
