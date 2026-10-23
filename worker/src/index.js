const STRIPE_API = "https://api.stripe.com/v1";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://tferre21.github.io";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin) });
    if (origin && origin !== allowedOrigin) return json({ error: "Origem não autorizada." }, 403, origin, allowedOrigin);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "globaltools-financeiro-billing",
        checkoutConfigured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID && env.PUBLIC_SITE_URL),
        databaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY),
        checkoutRemainsOffUntilValidPriceAndAuth: true
      }, 200, origin, allowedOrigin);
    }

    if (url.pathname === "/api/create-checkout-session" && request.method === "POST") {
      const missing = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "PUBLIC_SITE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"].filter(k => !env[k]);
      if (missing.length) return json({ error: "Checkout ainda não configurado no servidor." }, 503, origin, allowedOrigin);

      const bearer = request.headers.get("Authorization") || "";
      const match = bearer.match(/^Bearer\s+(.+)$/i);
      if (!match) return json({ error: "Entre na sua conta antes de contratar." }, 401, origin, allowedOrigin);
      const user = await getSupabaseUser(env, match[1]);
      if (!user?.id) return json({ error: "Sessão inválida ou expirada. Entre novamente." }, 401, origin, allowedOrigin);

      let body = {};
      try { body = await request.json(); } catch { return json({ error: "Corpo JSON inválido." }, 400, origin, allowedOrigin); }
      const email = typeof user.email === "string" ? user.email : "";
      if (!email) return json({ error: "Confirme seu e-mail antes de contratar." }, 400, origin, allowedOrigin);

      // Safety guard: only the intended active monthly BRL plan may be checked out.
      const priceResponse = await stripeFetch(env, "/prices/" + encodeURIComponent(env.STRIPE_PRICE_ID), "GET");
      if (!priceResponse.ok) return json({ error: "Preço Stripe não encontrado; checkout bloqueado." }, 503, origin, allowedOrigin);
      const price = await priceResponse.json();
      if (!price.active || price.currency !== "brl" || price.unit_amount !== 2990 || price.recurring?.interval !== "month" || price.recurring?.interval_count !== 1) {
        return json({ error: "Preço não corresponde ao plano aprovado de R$ 29,90/mês ou está inativo. Checkout bloqueado." }, 503, origin, allowedOrigin);
      }
      const productResponse = await stripeFetch(env, "/products/" + encodeURIComponent(price.product), "GET");
      if (!productResponse.ok) return json({ error: "Produto Stripe indisponível; checkout bloqueado." }, 503, origin, allowedOrigin);
      const product = await productResponse.json();
      if (!product.active || product.name !== "GlobalTools Financeiro — Plano Essencial") {
        return json({ error: "Produto ainda inativo ou não corresponde ao plano aprovado. Checkout bloqueado." }, 503, origin, allowedOrigin);
      }

      const form = new URLSearchParams();
      form.set("mode", "subscription");
      form.set("line_items[0][price]", price.id);
      form.set("line_items[0][quantity]", "1");
      form.set("success_url", env.PUBLIC_SITE_URL + "?checkout=success");
      form.set("cancel_url", env.PUBLIC_SITE_URL + "?checkout=cancelled");
      form.set("allow_promotion_codes", "true");
      form.set("customer_email", email);
      form.set("client_reference_id", user.id);
      form.set("metadata[user_id]", user.id);
      form.set("metadata[product]", "GlobalTools Financeiro");
      form.set("subscription_data[metadata][user_id]", user.id);
      form.set("subscription_data[metadata][product]", "GlobalTools Financeiro");
      const stripeResponse = await stripeFetch(env, "/checkout/sessions", "POST", form);
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
      if (!await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)) {
        return new Response("Assinatura inválida", { status: 400 });
      }
      let event;
      try { event = JSON.parse(rawBody); } catch { return new Response("JSON inválido", { status: 400 }); }
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error("Supabase webhook persistence is not configured");
        return new Response("Banco de dados não configurado", { status: 503 });
      }

      try {
        const alreadyProcessed = await supabaseRequest(env, "/rest/v1/stripe_webhook_events?event_id=eq." + encodeURIComponent(event.id) + "&select=event_id", "GET");
        if (alreadyProcessed.ok && (await alreadyProcessed.json()).length > 0) return new Response("already processed", { status: 200 });

        await syncStripeEvent(env, event);
        const mark = await supabaseRequest(env, "/rest/v1/stripe_webhook_events", "POST", {
          event_id: event.id, event_type: event.type
        }, { "Prefer": "resolution=ignore-duplicates,return=minimal" });
        if (!mark.ok) throw new Error("Could not record Stripe event id");
      } catch (error) {
        console.error("Stripe webhook processing failed", { eventId: event.id, eventType: event.type, message: String(error?.message || error) });
        return new Response("Webhook processing failed", { status: 500 });
      }
      return new Response("ok", { status: 200 });
    }
    return json({ error: "Rota não encontrada." }, 404, origin, allowedOrigin);
  }
};

async function stripeFetch(env, path, method = "GET", form) {
  const headers = { "Authorization": "Bearer " + env.STRIPE_SECRET_KEY };
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  return fetch(STRIPE_API + path, { method, headers, body: form ? form.toString() : undefined });
}

async function getSupabaseUser(env, accessToken) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
    headers: { "apikey": env.SUPABASE_ANON_KEY, "Authorization": "Bearer " + accessToken }
  });
  if (!response.ok) return null;
  return response.json();
}

async function supabaseRequest(env, path, method, body, extraHeaders = {}) {
  const headers = {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
    ...extraHeaders
  };
  return fetch(env.SUPABASE_URL.replace(/\/$/, "") + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function syncStripeEvent(env, event) {
  const object = event.data?.object || {};
  const supported = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed"
  ]);
  if (!supported.has(event.type)) return;

  let subscriptionId = null;
  let userId = null;
  let customerId = null;
  let priceId = null;
  let status = null;
  let periodEnd = null;
  let cancelAtPeriodEnd = false;

  if (event.type.startsWith("checkout.session.")) {
    if (object.mode !== "subscription" || !object.subscription) return;
    subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription.id;
    userId = object.metadata?.user_id || object.client_reference_id;
    customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
  } else if (event.type.startsWith("customer.subscription.")) {
    subscriptionId = object.id;
    userId = object.metadata?.user_id;
    customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
    status = object.status;
    periodEnd = object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null;
    cancelAtPeriodEnd = Boolean(object.cancel_at_period_end);
    priceId = object.items?.data?.[0]?.price?.id || null;
  } else {
    subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription?.id;
    if (!subscriptionId) return;
    status = event.type === "invoice.payment_failed" ? "past_due" : "active";
  }

  if (subscriptionId && (!userId || !status || !customerId || !priceId)) {
    const response = await stripeFetch(env, "/subscriptions/" + encodeURIComponent(subscriptionId), "GET");
    if (response.ok) {
      const sub = await response.json();
      userId = userId || sub.metadata?.user_id;
      customerId = customerId || (typeof sub.customer === "string" ? sub.customer : sub.customer?.id);
      status = status || sub.status;
      periodEnd = periodEnd || (sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null);
      cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
      priceId = priceId || sub.items?.data?.[0]?.price?.id || null;
    }
  }
  if (!subscriptionId || !userId || !customerId || !priceId || !status) {
    // Do not grant access or create an orphan subscription if Stripe metadata is incomplete.
    if (event.type === "checkout.session.completed") throw new Error("Missing authenticated user/subscription metadata");
    return;
  }

  const payload = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_price_id: priceId,
    status,
    current_period_end: periodEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
    last_stripe_event_created_at: event.created ? new Date(event.created * 1000).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const result = await supabaseRequest(env, "/rest/v1/subscriptions?on_conflict=stripe_subscription_id", "POST", payload, {
    "Prefer": "resolution=merge-duplicates,return=minimal"
  });
  if (!result.ok) throw new Error("Supabase subscription upsert failed with status " + result.status);
}

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
