# GlobalTools Financeiro SaaS

Aplicação inicial para controle financeiro de micro e pequenas empresas, com página de apresentação e painel demonstrativo.

## O que está incluído
- Página comercial em português com chamada para conhecer/contratar.
- Painel local demonstrativo de entradas, saídas, saldo e lançamentos.
- Cadastro local de lançamentos no navegador, com filtros e exportação CSV.
- Modelo de campanha de prospecção B2B por e-mail e orientação de conformidade.
- Documentação para implantação de autenticação, persistência na nuvem, e-mail transacional e cobrança recorrente.

## Atenção: estado do produto
Esta versão é um protótipo front-end. Os lançamentos são salvos apenas no navegador utilizado e não são sincronizados entre dispositivos. Não existe ainda autenticação, backend multiusuário, checkout conectado, confirmação de assinatura nem bloqueio automático por inadimplência. Não anuncie o protótipo como serviço de produção até essas integrações serem concluídas e testadas.

## Executar localmente
Abra `index.html` no navegador. Para um servidor local:
```bash
python -m http.server 8080
```
Acesse http://localhost:8080.

## Configuração comercial
Edite `config.js` para definir nome do produto, URL pública, preço e URL do checkout. Use URLs reais do site e do provedor de pagamentos; não coloque chaves secretas no front-end.

## Banco de dados e e-mail em preparação

Foi adicionado `supabase/schema.sql` com tabelas iniciais para perfis, empresas, membros, transações e assinaturas, além de políticas RLS e instruções em `supabase/README.md`. Revise e teste as políticas com contas separadas antes de inserir dados reais. A sincronização de assinaturas ainda não foi conectada ao banco.

Foi adicionado `email/README.md` com o processo para configurar o Resend. Nenhuma chave de API foi criada ou incluída no código, e nenhum e-mail comercial foi enviado.

## Integração Stripe em preparação

Foi adicionado um scaffold de backend em `worker/` para Cloudflare Workers:
- criação de Stripe Checkout para assinatura mensal usando Price ID configurado no servidor;
- verificação de assinatura criptográfica dos webhooks;
- configuração de checkout desligada por padrão no front-end (`apiBaseUrl` permanece vazio);
- instruções para configurar primeiro em modo de teste em `worker/README.md`.

**Não está pronto para cobrar nem para liberar acesso pago.** O webhook ainda não grava estados de assinatura em banco de dados e não há autenticação multiusuário. Não coloque chaves secretas no repositório. A conta Stripe conectada detectada nesta sessão está em modo live; não criei produtos, preços ou cobranças nela. Configure e teste usando as credenciais de teste do Stripe antes de habilitar o botão.

## Próximas etapas para produção
1. Escolher hospedagem (ex.: Cloudflare Pages ou Vercel) e domínio.
2. Criar backend e banco multiempresa (ex.: Supabase/PostgreSQL) com políticas de acesso por usuário/empresa.
3. Implementar login, recuperação de senha e isolamento de dados por empresa.
4. Criar produto e preço recorrente no Stripe em modo de teste (R$ 29,90 BRL/mês), configurar Checkout/Customer Portal e validar webhooks.
5. Criar webhooks assinados para ativar, renovar, suspender e cancelar assinaturas no servidor.
6. Integrar provedor de e-mail transacional para mensagens de boas-vindas, cobrança e prospecção autorizada.
7. Publicar política de privacidade, termos, contato do controlador e processo de descadastro.
8. Testar segurança, backup, acessibilidade e fluxo de pagamentos antes do lançamento.

## Prospecção responsável
Use informações empresariais públicas de forma compatível com a LGPD, com finalidade e base legal avaliadas, mensagem identificando o remetente, transparência sobre a origem do contato e descadastro simples. Não faça disparos em massa sem controles e não use e-mails pessoais coletados sem avaliação. O repositório não envia e-mails automaticamente.
