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
  function accountUrl() {
    return new URL("conta.html", config.publicSiteUrl || window.location.href).toString();
  }
  function goToPanel() {
    window.location.assign(new URL("index.html#painel", config.publicSiteUrl || window.location.href).toString());
  }

  $("#toggleMode").addEventListener("click", () => {
    mode = mode === "login" ? "signup" : "login";
    refreshMode();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!client) {
      setMessage("A conexão com o serviço de contas não foi carregada. Atualize a página; se persistir, confira a configuração do Supabase.", true);
      return;
    }
    const email = String(form.elements.email.value || "").trim();
    const password = String(form.elements.password.value || "");
    const fullName = String(form.elements.fullName.value || "").trim();
    const submittedMode = mode;
    if (submittedMode === "signup" && !fullName) {
      form.elements.fullName.setCustomValidity("Informe seu nome completo.");
      form.elements.fullName.reportValidity();
      form.elements.fullName.setCustomValidity("");
      return;
    }
    const submit = $("#authSubmit");
    submit.disabled = true;
    submit.textContent = "Aguarde...";
    try {
      if (submittedMode === "signup") {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: accountUrl()
          }
        });
        if (error) throw error;
        if (data.session) {
          goToPanel();
          return;
        }
        setMessage("O Supabase recebeu a solicitação, mas isso não confirma que um e-mail foi enviado. Verifique a caixa de entrada e o spam. Se nada chegar, o administrador precisa conferir o SMTP do Supabase e os limites de envio do Resend.");
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) {
          goToPanel();
          return;
        }
        setMessage("Login sem sessão ativa. Confirme o e-mail cadastrado ou solicite uma nova confirmação.");
      }
    } catch (error) {
      const raw = String(error?.message || "");
      if (/after .* seconds|rate limit|email rate limit|over_email_send_rate_limit/i.test(raw)) {
        setMessage("O limite de envio de e-mails do Supabase foi atingido. Aguarde o tempo informado antes de tentar novamente; não repita o cadastro.", true);
      } else if (/user already registered|already been registered/i.test(raw)) {
        setMessage("Este e-mail já está cadastrado. Tente entrar. Se a conta não estiver confirmada, precisamos corrigir o envio de confirmação.", true);
      } else if (/email not confirmed/i.test(raw)) {
        setMessage("Sua conta existe, mas o e-mail ainda não foi confirmado. Confira o SMTP/Resend e peça uma nova confirmação depois de corrigir o envio.", true);
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
    client.auth.getSession().then(({ data, error }) => {
      if (error) {
        setMessage("Não foi possível verificar sua sessão. Atualize a página.", true);
        return;
      }
      if (data.session) {
        setMessage("Você já está conectado. Abrindo seu painel...");
        setTimeout(() => goToPanel(), 500);
      }
    }).catch(() => setMessage("Não foi possível verificar sua sessão. Atualize a página.", true));
  }
  refreshMode();
})();