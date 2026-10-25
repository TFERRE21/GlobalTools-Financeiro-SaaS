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

O lote é limitado a cinco mensagens por execução. O estado em `data/prospecting-state.json` registra endereços enviados e impede repetição nesse arquivo. Preserve esse arquivo em armazenamento persistente do VPS e faça backup. Não execute duas instâncias ao mesmo tempo. Respostas com “SAIR” precisam ser processadas e adicionadas a `suppressed` no arquivo de estado antes de qualquer execução posterior; a integração automática de respostas/descadastro ainda não está implementada.

## Agendamento no VPS

Configure um cron/systemd timer no VPS para executar `npm run prospect:check` inicialmente. Só agende `prospect:send` depois de confirmar acesso à API CFO, revisar os resultados, verificar a política de privacidade/base legal e testar envio para um endereço próprio. O código não cria nem instala o agendamento por conta própria.

## Limitações importantes

- O código não faz deploy remoto por si só.
- A CFO exige credenciais e pode limitar os campos e o volume conforme o plano.
- O estado local evita duplicidade apenas na mesma instalação; mantenha o arquivo persistente.
- O Resend confirma aceitação da mensagem, não garante entrega na caixa de entrada.
