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
  form.addEventListener("submit", event => {
    event.preventDefault();
    const fd = new FormData(form);
    const description = String(fd.get("description") || "").trim();
    const amount = Number(fd.get("amount"));
    const date = String(fd.get("date") || "");
    if (!description || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      alert("Informe descrição, data e valor positivo válidos.");
      return;
    }
    entries.push({id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2), description, amount: Math.round(amount*100)/100, date, category: String(fd.get("category") || "").trim(), type: fd.get("type") === "expense" ? "expense" : "income"});
    if (saveEntries()) { form.reset(); form.elements.date.value = localDate; render(); }
  });
  table.addEventListener("click", event => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    entries = entries.filter(x => x.id !== button.dataset.delete);
    if (saveEntries()) render();
  });
  $("#typeFilter").addEventListener("change", render);
  $("#clearData").addEventListener("click", () => {
    if (!entries.length) return;
    if (confirm("Apagar todos os lançamentos deste navegador? Esta ação não pode ser desfeita.")) {
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
  if (config.priceValue) $("#priceLabel").textContent = config.priceValue;
  const checkout = $("#checkoutLink");
  if (config.checkoutUrl) {
    checkout.href = config.checkoutUrl;
    checkout.target = "_blank";
    checkout.rel = "noopener noreferrer";
    checkout.textContent = "Assinar agora";
    $("#checkoutNote").textContent = "A contratação será processada no provedor de pagamento configurado.";
  } else {
    checkout.addEventListener("click", event => {
      event.preventDefault();
      alert("A contratação online ainda não está ativa. O checkout precisa ser configurado antes da publicação comercial.");
    });
  }
  $("#year").textContent = String(new Date().getFullYear());
  render();
})();