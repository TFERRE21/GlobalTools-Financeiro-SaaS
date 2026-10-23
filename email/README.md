# Resend — e-mails transacionais

A conta Resend conectada tem o domínio `oolivo.com.br` verificado e habilitado para envio. Antes de usar, confirme que esse domínio é apropriado para a marca GlobalTools; preferencialmente configure um domínio próprio da marca e um remetente monitorado, como `suporte@SEU-DOMINIO`.

## Fluxos recomendados
- Confirmação de cadastro e verificação de e-mail.
- Recibo/aviso de assinatura após evento Stripe validado no servidor.
- Aviso de pagamento recusado e link para atualizar o meio de pagamento.
- Confirmação de cancelamento.
- E-mails comerciais somente com avaliação de base legal, transparência, minimização de dados e mecanismo simples de oposição/descadastro.

## Configuração
1. Verifique o domínio remetente no Resend.
2. Crie uma chave de API com permissão de envio e restrita ao domínio, se disponível.
3. Salve a chave como secret do backend (`RESEND_API_KEY`); não a coloque em arquivos públicos nem em GitHub.
4. Defina `EMAIL_FROM` com um endereço pertencente ao domínio verificado e `SUPPORT_EMAIL` com o endereço real de suporte.
5. Envie um e-mail de teste para uma caixa controlada e confira entrega, SPF/DKIM/DMARC, respostas e tratamento de bounce/complaint.

## Importante
Ainda não há envio automático implementado no app. Não faça campanhas em massa a partir de cadastros públicos sem avaliação jurídica e controles de consentimento/base legal, supressão, descadastro e reputação.
