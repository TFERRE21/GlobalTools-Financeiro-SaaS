(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const form = $("#entryForm");
  const table = $("#entriesBody");
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const dateFmt = (value) => {
    if (!value) return "—";
    const [y,m,d] = value.split("-");
    return y && m && d ? `${d}/${m}/${y}` : value;
  };
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  form.elements.date.value = localDate;
  let entries = loadEntries();

  function loadEntries() {
    try {
      const parsed = JSON.parse(localStorage.getItem("gt-finance-demo-v1") || "[]");
      return Array.isArray(parsed) ? parsed.filter(x => x && typeof x.id === "string" && typeof x.description === "string" && Number.isFinite(Number(x.amount))) : [];
    } catch { return []; }
  }
  function saveEntries() {
    try {
      localStorage.setItem("gt-finance-demo-v1", JSON.stringify(entries));
      return true;
    } catch {
      alert("Não foi possível salvar neste navegador. Confira o espaço disponível ou as configurações de privacidade.");
      return false;
    }
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function render() {
    const filter = $("#typeFilter").value;
    const visible = entries.filter(x => filter === "all" || x.type === filter).sort((a,b) => b.date.localeCompare(a.date));
    const income = entries.filter(x => x.type === "income").reduce((s,x) => s + Number(x.amount),0);
    const expense = entries.filter(x => x.type === "expense").reduce((s,x) => s + Number(x.amount),0);
    $("#totalIncome").textContent = currency.format(income);
    $("#totalExpense").textContent = currency.format(expense);
    $("#totalBalance").textContent = currency.format(income-expense);
    $("#totalBalance").className = income-expense < 0 ? "negative" : "amount-income";
    table.innerHTML = visible.length ? visible.map(x => `<tr>
      <td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.category || "—")}</td>
      <td>${dateFmt(x.date)}</td><td>${x.type === "income" ? "Entrada" : "Saída"}</td>
      <td class="numeric ${x.type === "income" ? "amount-income" : "amount-expense"}">${x.type === "income" ? "+" : "−"} ${currency.format(Number(x.amount))}</td>
      <td><button class="delete-entry" type="button" data-delete="${escapeHtml(x.id)}" aria-label="Excluir ${escapeHtml(x.description)}">Excluir</button></td>
    </tr>`).join("") : '<tr><td colspan="6" class="empty">Nenhum lançamento encontrado.</td></tr>';
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(form);
    const description = String(fd.get("description") || "").trim();
    const amount = Number(fd.get("amount"));
    const date = String(fd.get("date") || "");
    if (!description || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      alert("Informe descrição, data e valor positivo válidos.");
      return;
    }
    const category = String(fd.get("category") || "").trim();
    const type = fd.get("type") === "expense" ? "expense" : "income";
    if (cloudMode) {
      if (!cloudSession || !cloudCompanyId) { alert("Os dados da nuvem ainda não carregaram. Atualize a página ou tente novamente."); return; }
      const { data, error } = await supabaseClient.from("transactions").insert({
        company_id: cloudCompanyId, created_by: cloudSession.user.id, description, category,
        transaction_type: type, amount_cents: Math.round(amount * 100), transaction_date: date
      }).select("id,description,category,transaction_type,amount_cents,transaction_date").single();
      if (error) { alert("Não foi possível salvar na nuvem: " + error.message); return; }
      entries.push({ id: data.id, description: data.description, amount: data.amount_cents / 100, date: data.transaction_date, category: data.category || "", type: data.transaction_type });
      form.reset(); form.elements.date.value = localDate; render(); return;
    }
    entries.push({id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2), description, amount: Math.round(amount*100)/100, date, category, type});
    if (saveEntries()) { form.reset(); form.elements.date.value = localDate; render(); }
  });
  table.addEventListener("click", async event => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    if (cloudMode) {
      if (!cloudCompanyId) { alert("A conta ainda não está sincronizada."); return; }
      const { error } = await supabaseClient.from("transactions").delete().eq("id", button.dataset.delete).eq("company_id", cloudCompanyId);
      if (error) { alert("Não foi possível excluir na nuvem: " + error.message); return; }
      entries = entries.filter(x => x.id !== button.dataset.delete); render(); return;
    }
    entries = entries.filter(x => x.id !== button.dataset.delete);
    if (saveEntries()) render();
  });
  $("#typeFilter").addEventListener("change", render);
  $("#clearData").addEventListener("click", async () => {
    if (!entries.length) return;
    if (confirm("Apagar todos os lançamentos deste navegador? Esta ação não pode ser desfeita.")) {
      if (cloudMode) {
        if (!cloudCompanyId) { alert("A conta ainda não está sincronizada."); return; }
        const { error } = await supabaseClient.from("transactions").delete().eq("company_id", cloudCompanyId);
        if (error) { alert("Não foi possível apagar na nuvem: " + error.message); return; }
        entries = []; render(); return;
      }
      entries = [];
      if (saveEntries()) render();
    }
  });
  $("#exportCsv").addEventListener("click", () => {
    const rows = [["Descrição","Categoria","Data","Tipo","Valor"], ...entries.map(x => [x.description, x.category, x.date, x.type === "income" ? "Entrada" : "Saída", Number(x.amount).toFixed(2).replace(".",",")])];
    const csv = "\uFEFF" + rows.map(row => row.map(value => '"' + String(value).replace(/"/g,'""') + '"').join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"}));
    const a = document.createElement("a"); a.href = url; a.download = "globaltools-lancamentos.csv"; a.click(); URL.revokeObjectURL(url);
  });
  const config = window.GLOBALTOOLS_CONFIG || {};
  const supabaseClient = (window.supabase && config.supabaseUrl && config.supabaseAnonKey)
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;
  let cloudMode = false;
  let cloudSession = null;
  let cloudCompanyId = null;

  async function initCloudData() {
    if (!supabaseClient) return;
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) { $("#storageNote").textContent = "Não foi possível validar a sessão da conta."; return; }
    if (!session) {
      $("#storageNote").textContent = "Demonstração local: entre na sua conta para usar dados sincronizados quando o backend estiver configurado.";
      return;
    }
    cloudMode = true;
    cloudSession = session;
    try {
      let { data: company, error } = await supabaseClient.from("companies")
        .select("id,display_name").eq("owner_id", session.user.id).limit(1).maybeSingle();
      if (error) throw error;
      if (!company) {
        const created = await supabaseClient.from("companies").insert({
          owner_id: session.user.id,
          display_name: (session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Minha empresa") + " — empresa"
        }).select("id,display_name").single();
        if (created.error) throw created.error;
        company = created.data;
      }
      cloudCompanyId = company.id;

      // Consulta o status da assinatura no banco; o front-end apenas informa o status.
      // A liberação de recursos pagos precisa também ser validada no backend/webhook.
      const subscriptionResult = await supabaseClient.from("subscriptions")
        .select("status,current_period_end,cancel_at_period_end")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let planStatus = "não ativo";
      if (!subscriptionResult.error && subscriptionResult.data) {
        const sub = subscriptionResult.data;
        const periodIsValid = !sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now();
        if (["active", "trialing"].includes(sub.status) && periodIsValid) {
          planStatus = sub.status === "trialing" ? "em período de teste" : "ativo";
        } else if (sub.status === "past_due") {
          planStatus = "com pagamento pendente";
        } else if (["canceled", "incomplete_expired", "unpaid", "paused"].includes(sub.status)) {
          planStatus = "inativo";
        } else {
          planStatus = "não ativo";
        }
      } else if (subscriptionResult.error) {
        console.warn("Subscription status could not be checked", subscriptionResult.error);
        planStatus = "não foi possível verificar";
      }
      const planNotice = "Plano: " + planStatus + ". ";
      const result = await supabaseClient.from("transactions")
        .select("id,description,category,transaction_type,amount_cents,transaction_date")
        .eq("company_id", cloudCompanyId).order("transaction_date", { ascending: false });
      if (result.error) throw result.error;
      entries = (result.data || []).map(row => ({
        id: row.id, description: row.description, category: row.category || "",
        type: row.transaction_type, amount: Number(row.amount_cents) / 100, date: row.transaction_date
      }));
      $("#storageNote").textContent = planNotice + "Dados sincronizados com a conta: " + company.display_name + ".";
      render();
    } catch (error) {
      $("#storageNote").textContent = "A conta está conectada, mas o banco ainda não está pronto: " + (error?.message || "erro de configuração");
      console.error("Cloud data initialization failed", error);
    }
  }
  if (config.priceValue) $("#priceLabel").textContent = config.priceValue;
  const checkout = $("#checkoutLink");
  const checkoutState = new URLSearchParams(window.location.search).get("checkout");
  if (checkoutState === "success") {
    $("#checkoutNote").textContent = "Retorno do checkout recebido. A confirmação da assinatura depende da validação segura do servidor; não feche esta página se precisar de suporte.";
  } else if (checkoutState === "cancelled") {
    $("#checkoutNote").textContent = "Checkout cancelado. Nenhuma assinatura deve ser considerada ativa.";
  }

  if (config.checkoutUrl) {
    checkout.href = config.checkoutUrl;
    checkout.target = "_blank";
    checkout.rel = "noopener noreferrer";
    checkout.textContent = "Abrir checkout";
    $("#checkoutNote").textContent = "Checkout externo configurado. Confirme o modo de teste antes de usar.";
  } else if (config.apiBaseUrl) {
    checkout.textContent = "Continuar para checkout";
    checkout.addEventListener("click", async event => {
      event.preventDefault();
      checkout.setAttribute("aria-disabled", "true");
      checkout.textContent = "Preparando checkout…";
      try {
        if (!supabaseClient) throw new Error("Login ainda não configurado. Configure o Supabase antes de habilitar a contratação.");
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session?.access_token) throw new Error("Entre na sua conta antes de contratar.");
        const response = await fetch(config.apiBaseUrl.replace(/\/$/, "") + "/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
          body: JSON.stringify({})
        });
        const data = await response.json();
        if (!response.ok || !data.url) throw new Error(data.error || "Checkout indisponível");
        window.location.assign(data.url);
      } catch (error) {
        $("#checkoutNote").textContent = "Checkout indisponível: " + (error.message || "tente novamente mais tarde.");
        checkout.removeAttribute("aria-disabled");
        checkout.textContent = "Tentar novamente";
      }
    });
    $("#checkoutNote").textContent = "Checkout Stripe via backend. Ative esta configuração somente depois de validar o fluxo em modo de teste.";
  } else {
    checkout.addEventListener("click", event => {
      event.preventDefault();
      alert("A contratação online continua desativada. Configure e teste o backend Stripe antes de habilitar o checkout.");
    });
  }
  $("#year").textContent = String(new Date().getFullYear());
  render();
  initCloudData();
})();