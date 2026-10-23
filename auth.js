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
    message.style.color = isError ? "#b42318" : "#52647f";
  }
  function refreshMode() {
    const signup = mode === "signup";
    $("#authTitle").textContent = signup ? "Crie sua conta" : "Acesse sua conta";
    $("#authSubmit").textContent = signup ? "Criar minha conta →" : "Entrar no sistema →";
    $("#toggleMode").textContent = signup ? "Já tenho uma conta" : "＋ Criar nova conta";
    $("#nameLabel").hidden = !signup;
    form.elements.password.autocomplete = signup ? "new-password" : "current-password";
    form.elements.password.placeholder = signup ? "Crie uma senha com pelo menos 8 caracteres" : "Digite sua senha";
    setMessage("");
  }
  $("#toggleMode").addEventListener("click", () => {
    mode = mode === "login" ? "signup" : "login";
    refreshMode();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!client) {
      setMessage("O serviço de autenticação não está disponível no momento. Tente novamente mais tarde.", true);
      return;
    }
    const email = String(form.elements.email.value || "").trim();
    const password = String(form.elements.password.value || "");
    const fullName = String(form.elements.fullName.value || "").trim();
    if (mode === "signup" && !fullName) {
      form.elements.fullName.setCustomValidity("Informe seu nome completo.");
      form.elements.fullName.reportValidity();
      form.elements.fullName.setCustomValidity("");
      return;
    }
    $("#authSubmit").disabled = true;
    $("#authSubmit").textContent = "Aguarde...";
    try {
      if (mode === "signup") {
        const { data, error } = await client.auth.signUp({
          email, password,
          options: { data: { full_name: fullName }, emailRedirectTo: new URL("conta.html", config.publicSiteUrl || window.location.href).toString() }
        });
        if (error) throw error;
        if (data.session) window.location.assign("index.html");
        else setMessage("Cadastro iniciado! Verifique seu e-mail para confirmar a conta.");
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) window.location.assign("index.html");
      }
    } catch (error) {
      setMessage(error?.message || "Não foi possível concluir. Confira seus dados e tente novamente.", true);
    } finally {
      $("#authSubmit").disabled = false;
      refreshMode();
    }
  });

  if (window.supabase && config.supabaseUrl && config.supabaseAnonKey) {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    client.auth.getSession().then(({ data }) => {
      if (data.session) setMessage("Você já está conectado. Volte ao painel para continuar.");
    }).catch(() => setMessage("Não foi possível verificar sua sessão. Atualize a página.", true));
  }
  refreshMode();
})();