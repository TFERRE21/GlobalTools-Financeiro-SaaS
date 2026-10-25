# DayMoney Prospecção — serviço isolado

Este diretório é um serviço independente para o painel de prospecção. Ele não altera as rotas nem as tabelas do SaaS financeiro.

## Configuração

1. Crie um banco PostgreSQL exclusivo para a prospecção e configure `DATABASE_URL`.
2. Configure `JWT_SECRET` com um valor aleatório de pelo menos 32 caracteres.
3. Configure `ADMIN_EMAIL` e `ADMIN_PASSWORD_HASH` (hash bcrypt; nunca grave senha em texto puro).
4. Configure `RESEND_API_KEY` e `RESEND_FROM_EMAIL` somente com remetente verificado.
5. Instale dependências e rode `npm start` dentro deste diretório.

## Estado inicial

O serviço registra empresas consultadas, fontes, e-mails encontrados, descartes e eventos de envio/entrega. O painel não inventa empresas nem afirma que o robô está rodando se não houver heartbeat. A descoberta automática de CNPJs ainda precisa ser conectada a uma fonte de dados autorizada; este scaffold não inicia envios em massa automaticamente.

## Deploy

Não aponte a raiz do deploy atual para este diretório: isso substituiria a aplicação financeira no mesmo destino. Publique como segundo serviço/contêiner (porta padrão 3015) ou em um subdomínio separado, com banco próprio e HTTPS.
