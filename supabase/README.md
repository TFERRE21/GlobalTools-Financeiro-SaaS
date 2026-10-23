# Supabase — banco e isolamento por empresa

Este diretório contém o esquema inicial para autenticação, empresas, movimentações financeiras e assinaturas Stripe.

## Preparar
1. Crie um projeto em https://supabase.com/dashboard.
2. Abra SQL Editor e execute `schema.sql` depois de revisar o conteúdo.
3. Em Authentication, configure URLs de redirecionamento para o domínio final.
4. Guarde URL do projeto e chave pública (anon/publishable) para o front-end; a chave `service_role` deve existir apenas no servidor como secret.
5. Crie fluxo de cadastro/login, criação de empresa e associação do usuário. Não habilite funcionalidades financeiras antes de testar o isolamento entre duas contas distintas.

## Segurança e lacunas
- RLS está habilitada nas tabelas do esquema.
- A tabela de assinatura não aceita alterações diretas de usuários; apenas o servidor confiável deve sincronizá-la.
- A associação do Stripe Checkout ao usuário autenticado ainda precisa ser implementada. Nunca aceite `user_id` enviado pelo navegador como prova de identidade; derive-o da sessão validada no servidor.
- A política de leitura de transações é por empresa; membership writes estão intencionalmente reservados ao servidor até que convites e elevação de função sejam implementados.
- Faça testes de RLS com usuários/empresas diferentes antes de guardar dados reais.
- Este SQL é um ponto de partida e não substitui revisão de segurança, backup, monitoramento, retenção e conformidade LGPD.
