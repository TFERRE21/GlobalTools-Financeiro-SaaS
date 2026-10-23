# Backend de cobrança — Cloudflare Workers + Stripe

Este é um scaffold de integração. **Não está ativado para cobranças reais** e não deve ser tratado como SaaS pronto para produção.

## O que implementa
- Endpoint `GET /health` para diagnóstico sem expor segredos.
- Endpoint `POST /api/create-checkout-session` para criar Checkout em modo subscription usando um Price ID configurado no servidor.
- Endpoint `POST /api/stripe-webhook` com verificação da assinatura Stripe e tolerância de timestamp.
- CORS restrito à origem configurada.

## Pré-requisitos
1. Conta Stripe verificada e habilitada para receber pagamentos no Brasil.
2. Cloudflare account e Wrangler instalado.
3. Criar o produto **GlobalTools Financeiro — Plano Essencial** no Stripe em **modo de teste** e criar preço recorrente mensal de **R$ 29,90 BRL**. Copiar o Price ID de teste (`price_...`).
4. Não usar a chave `sk_live_...` nesta etapa.

## Publicação de teste
1. Copie `wrangler.toml.example` para `wrangler.toml` e ajuste as URLs.
2. No diretório `worker`, execute `npx wrangler login`.
3. Defina segredos no ambiente de teste:
   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_PRICE_ID
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
   Use somente a chave `sk_test_...` e o Price ID de teste. O segredo de webhook vem do endpoint de teste criado no Stripe.
4. Publique com `npx wrangler deploy`.
5. No Stripe Dashboard em modo de teste, adicione endpoint `https://SEU-WORKER.workers.dev/api/stripe-webhook` e assine eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
6. Teste com cartão de teste oficial do Stripe e confirme os eventos em Developers/Webhooks. Não use cartões reais.
7. Defina `API_BASE_URL` no site apenas depois de testar o Worker.

## Limitações importantes antes de produção
- Este scaffold **não armazena usuários nem assinaturas** e não libera/bloqueia acesso a funcionalidades. O webhook apenas valida e registra o evento. Não use o redirect de sucesso como prova de pagamento.
- Antes de cobrar clientes reais, implementar banco de dados e idempotência de eventos, autenticação, associação segura entre cliente e assinatura, Customer Portal/cancelamento, recuperação de pagamento, logs sem dados sensíveis, rate limiting, monitoramento e testes.
- Configure a chave secreta do Stripe e o segredo de webhook como secrets no Cloudflare. Nunca os grave no GitHub, em `config.js` ou no navegador.
- GitHub Pages hospeda apenas o front-end estático; o Worker é uma implantação separada.
- A integração de e-mail via Resend ainda não envia mensagens neste scaffold. Configure domínio remetente e implemente e-mails transacionais após persistência/idempotência.
- Verifique termos, política de privacidade, obrigações fiscais e requisitos aplicáveis no Brasil antes do lançamento.

## Endpoints
- `GET /health`
- `POST /api/create-checkout-session` — JSON opcional: `{"email":"cliente@exemplo.com"}`
- `POST /api/stripe-webhook` — exclusivo para eventos assinados pelo Stripe.


## Autenticação e sincronização de assinaturas
- O endpoint de Checkout exige um access token Supabase válido e deriva o usuário do endpoint Auth, não de um `user_id` enviado pelo navegador.
- Antes de criar Checkout, o Worker confirma que o Price está ativo, é BRL 2.990 por mês e que o produto correto também está ativo.
- Webhooks assinados sincronizam estados de assinatura com a tabela `subscriptions` e gravam IDs de eventos para deduplicação básica.
- Configure secrets adicionais: `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. A chave service role só pode existir no Worker.
- O site inclui uma tela inicial de login/cadastro, mas permanece inoperante até que URL/chave pública do Supabase e backend sejam configurados.
- Antes de produção, teste concorrência/idempotência dos webhooks, políticas RLS, cancelamento e ciclo de vida. Só ative um Price depois de validar o fluxo completo em modo de teste.
