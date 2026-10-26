# Robô de prospecção (VPS)

Este diretório implementa um processo inicial de prospecção B2B separado do servidor estático. Usa a API CFO como fonte de descoberta (requer token válido), valida CNPJ/data/e-mail e envia pelo Resend apenas contatos empresariais encontrados nos dados retornados pela fonte.

## Configuração

Configure no ambiente do VPS as variáveis de `.env.example`. Não coloque tokens no GitHub nem no chat. A conta/plano da CFO precisa permitir a consulta. Se a API retornar outro formato, o processo falha sem enviar e-mails, para evitar envio com dados interpretados incorretamente.

## Executar em modo de conferência

```bash
npm run prospect:check
```

Por padrão, `SEND_EMAILS=false`: só mostra candidatos elegíveis. Revise os dados e confirme que o remetente do Resend está verificado.

## Envio controlado

Depois de validar a origem e os candidatos, configure `SEND_EMAILS=true` e execute:

```bash
npm run prospect:send
```

O robô limita a prospecção a até 70 mensagens por dia (horário local de Brasília), desde que `PROSPECT_DAILY_LIMIT` não seja configurado para um valor menor. O envio da planilha comprada possui limite separado de até 30 e-mails por dia. Esses limites reservam nominalmente 70 + 30 envios; outros serviços que usem a mesma conta Resend também consomem a cota da conta. O estado em `data/prospecting-state.json` registra envios e supressões; preserve esse arquivo em armazenamento persistente do VPS e faça backup. Não execute duas instâncias ao mesmo tempo.\n\n### Respostas SAIR / descadastro\n\nO servidor possui o endpoint `POST /webhooks/resend-inbound`, que valida a assinatura Svix/Resend, recupera o corpo da mensagem recebida e registra o endereço em `suppressed` quando a primeira linha não citada da resposta contém apenas um comando como `SAIR`, `PARAR`, `CANCELAR` ou `DESCADASTRAR`. O envio de prospecção verifica essa lista antes de enviar. Para isso funcionar de ponta a ponta, o subdomínio `reply.oolivo.com.br` foi criado no Resend com recebimento habilitado e envio desabilitado. Configure os registros DNS mostrados no Resend; depois que o domínio for verificado, configure `PROSPECT_REPLY_TO=sair@reply.oolivo.com.br` e `RESEND_WEBHOOK_SECRET` no ambiente do VPS. O webhook `email.received` já foi criado apontando para `https://daymoney.com.br/webhooks/resend-inbound`. Não altere `PROSPECT_OPT_OUT_READY=true` até testar uma resposta real `SAIR` e confirmar que o endereço aparece em `data/prospecting-state.json` dentro de `suppressed`.

## Agendamento no VPS

Configure um cron/systemd timer no VPS para executar `npm run prospect:check` inicialmente. Só agende `prospect:send` depois de confirmar acesso à API CFO, revisar os resultados, verificar a política de privacidade/base legal e testar envio para um endereço próprio. O código não cria nem instala o agendamento por conta própria.

## Limitações importantes

- O código não faz deploy remoto por si só.
- A CFO exige credenciais e pode limitar os campos e o volume conforme o plano.
- O estado local evita duplicidade apenas na mesma instalação; mantenha o arquivo persistente.
- O Resend confirma aceitação da mensagem, não garante entrega na caixa de entrada.
