(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const config = window.GLOBALTOOLS_CONFIG || {};
  const form = $("#authForm");
  const message = $("#authMessage");
  let mode = "login";
  let client = null;

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.style.color = isError ? "#f87171" : "inherit";
  }
  function refreshMode() {
    const signup = mode === "signup";
    $("#authTitle").textContent = signup ? "Criar conta" : "Entrar";
    $("#authSubmit").textContent = signup ? "Criar conta" : "Entrar";
    $("#toggleMode").textContent = signup ? "Já tenho uma conta" : "Criar uma conta";
    $("#nameLabel").hidden = !signup;
    form.elements.password.autocomplete = signup ? "new-password" : "current-password";
    setMessage("");
  }
  $("#toggleMode").addEventListener("click", () => {
    mode = mode === "login" ? "signup" : "login";
    refreshMode();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!client) {
      setMessage("Autenticação ainda não está conectada. Configure supabaseUrl e supabaseAnonKey em config.js após criar o projeto Supabase.", true);
      return;
    }
    const email = String(form.elements.email.value || "").trim();
    const password = String(form.elements.password.value || "");
    const fullName = String(form.elements.fullName.value || "").trim();
    $("#authSubmit").disabled = true;
    try {
      if (mode === "signup") {
        const { data, error } = await client.auth.signUp({
          email, password,
          options: { data: { full_name: fullName }, emailRedirectTo: new URL("conta.html", config.publicSiteUrl || window.location.href).toString() }
        });
        if (error) throw error;
        if (data.session) window.location.assign("index.html");
        else setMessage("Cadastro iniciado. Verifique seu e-mail para confirmar a conta.");
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) window.location.assign("index.html");
      }
    } catch (error) {
      setMessage(error?.message || "Não foi possível concluir. Tente novamente.", true);
    } finally {
      $("#authSubmit").disabled = false;
    }
  });

  if (window.supabase && config.supabaseUrl && config.supabaseAnonKey) {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    client.auth.getSession().then(({ data }) => {
      if (data.session) setMessage("Você já está conectado. Volte ao painel para continuar.");
    });
  }
  refreshMode();
})();