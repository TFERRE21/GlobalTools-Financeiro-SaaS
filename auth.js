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
  function refreshMode(clearMessage = true) {
    const signup = mode === "signup";
    $("#authTitle").textContent = signup ? "Crie sua conta" : "Acesse sua conta";
    $("#authSubmit").textContent = signup ? "Criar minha conta →" : "Entrar no sistema →";
    $("#toggleMode").textContent = signup ? "Já tenho uma conta" : "＋ Criar nova conta";
    $("#nameLabel").hidden = !signup;
    form.elements.password.autocomplete = signup ? "new-password" : "current-password";
    form.elements.password.placeholder = signup ? "Crie uma senha com pelo menos 8 caracteres" : "Digite sua senha";
    if (clearMessage) setMessage("");
  }
  $("#toggleMode").addEventListener("click", () => {
    mode = mode === "login" ? "signup" : "login";
    refreshMode();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!client) {
      setMessage("O serviço de autenticação não está disponível no momento. Atualize a página e tente novamente.", true);
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
    const submit = $("#authSubmit");
    const submittedMode = mode;
    submit.disabled = true;
    submit.textContent = "Aguarde...";
    try {
      if (submittedMode === "signup") {
        const { data, error } = await client.auth.signUp({
          email, password,
          options: { data: { full_name: fullName }, emailRedirectTo: new URL("conta.html", config.publicSiteUrl || window.location.href).toString() }
        });
        if (error) throw error;
        if (data.session) {
          window.location.assign("index.html");
          return;
        }
        setMessage("Solicitação de cadastro recebida. Se o e-mail for elegível, verifique sua caixa de entrada e o spam para confirmar a conta.");
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) {
          window.location.assign("index.html");
          return;
        }
      }
    } catch (error) {
      const raw = String(error?.message || "");
      if (/after .* seconds|rate limit|email rate limit/i.test(raw)) {
        setMessage("O Supabase limitou temporariamente o envio de e-mails. Aguarde o tempo indicado na mensagem antes de tentar novamente.", true);
      } else if (/user already registered/i.test(raw)) {
        setMessage("Este e-mail já possui cadastro. Use “Já tenho uma conta” para entrar.", true);
      } else {
        setMessage(raw || "Não foi possível concluir. Confira os dados e tente novamente.", true);
      }
    } finally {
      submit.disabled = false;
      refreshMode(false);
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