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

## Próximas etapas para produção
1. Escolher hospedagem (ex.: Cloudflare Pages ou Vercel) e domínio.
2. Criar backend e banco multiempresa (ex.: Supabase/PostgreSQL) com políticas de acesso por usuário/empresa.
3. Implementar login, recuperação de senha e isolamento de dados por empresa.
4. Criar produto e preço recorrente no gateway escolhido e configurar checkout/portal do cliente.
5. Criar webhooks assinados para ativar, renovar, suspender e cancelar assinaturas no servidor.
6. Integrar provedor de e-mail transacional para mensagens de boas-vindas, cobrança e prospecção autorizada.
7. Publicar política de privacidade, termos, contato do controlador e processo de descadastro.
8. Testar segurança, backup, acessibilidade e fluxo de pagamentos antes do lançamento.

## Prospecção responsável
Use informações empresariais públicas de forma compatível com a LGPD, com finalidade e base legal avaliadas, mensagem identificando o remetente, transparência sobre a origem do contato e descadastro simples. Não faça disparos em massa sem controles e não use e-mails pessoais coletados sem avaliação. O repositório não envia e-mails automaticamente.
