# Construir Juntos — starter técnico para configurar

## O que está incluído
- Página de vendas bilíngue para o produto “Do Zero ao Primeiro Cliente”.
- Preço fixo de teste: US$ 7.90.
- Backend Node.js/Express com criação e captura de pedido via PayPal Orders API.
- SQLite para registrar pedidos e tokens de download.
- PDFs em pasta privada, fora da pasta pública.
- Links temporários de download de uso único (48 horas).
- Envio de e-mail por SMTP após confirmação de pagamento.
- Endpoint administrativo básico protegido por token para consultar pedidos.
- Arquivo `.env.example` sem credenciais reais.

## Status honesto
Este é um starter técnico, não um sistema já publicado. Pagamentos só podem ser ativados depois que as credenciais PayPal forem configuradas. E-mail automático só funciona depois de configurar SMTP. A entrega de e-mail depende de SMTP operacional. Nenhum pagamento real foi feito ou testado neste pacote.

## Pré-requisitos
- Node.js 20 ou mais recente.
- Railway (ou hospedagem equivalente) com processo Node.js persistente e volume persistente para o SQLite; hospedagem puramente estática não basta. O servidor aceita `DATA_DIR` para colocar o banco em um volume.
- Conta PayPal Business e acesso ao PayPal Developer Dashboard.
- Provedor de e-mail/SMTP.
- Domínio/URL HTTPS pública para produção.

## Executar localmente no Windows
1. Extraia o ZIP para uma pasta simples, por exemplo `C:\ConstruirJuntos`.
2. Dê dois cliques em `INICIAR-SITE-WINDOWS.bat`. Ele verifica o Node.js, cria `.env` se necessário, instala as dependências e inicia o site.
3. Abra `http://localhost:3000` se o navegador não abrir automaticamente.
4. A primeira execução exige internet para baixar dependências.


## Configuracao automatica no Windows
1. Extraia o pacote inteiro para uma pasta local.
2. Instale Node.js LTS 20 ou superior em https://nodejs.org/ se ainda nao estiver instalado.
3. De dois cliques em `CONFIGURAR-E-INICIAR.bat`. O assistente cria `.env` se necessario, gera um `ADMIN_TOKEN` local, cria a pasta `data`, instala dependencias, verifica a sintaxe e inicia o servidor.
4. O SQLite e criado automaticamente em `data/data.sqlite` na primeira inicializacao.
5. O assistente nao conecta contas externas nem publica automaticamente no Railway. PayPal Sandbox, SMTP e variaveis de producao precisam ser configurados separadamente. Nunca envie `.env` ao GitHub.

## Configuração manual (alternativa)
1. Extraia o ZIP.
2. Instale Node.js 20+.
3. Copie `.env.example` para `.env`.
4. Preencha `PAYPAL_CLIENT_ID` e `PAYPAL_CLIENT_SECRET` com credenciais SANDBOX do PayPal Developer Dashboard.
5. Configure SMTP de teste para não enviar mensagens reais por engano; se SMTP não estiver configurado, o pagamento poderá ser capturado mas o email de entrega não será enviado.
6. No terminal, dentro da pasta do projeto:
   - `npm install`
   - `npm start`
7. Abra `http://localhost:3000`.
8. Faça testes apenas com contas sandbox e compradores sandbox.


## Publicação no Railway (primeiro ambiente: sandbox)

1. Crie/entre na sua conta GitHub e crie um repositório privado chamado `construir-juntos`. Não envie `.env`, credenciais, `data.sqlite` nem `node_modules`.
2. Extraia este pacote e envie o conteúdo da pasta `construir-juntos-pronto-para-configurar` para a raiz do repositório. Confirme que `package.json`, `server.js`, `public/` e `private/` estão na raiz do projeto.
3. No Railway, crie um projeto usando **Deploy from GitHub repo** e selecione esse repositório. O app usa `npm start` e exige Node.js 20+.
4. No serviço do app, abra **Settings/Networking** e gere um domínio gratuito `*.up.railway.app`. Copie a URL HTTPS.
5. Adicione um **Volume** ao serviço, com mount path `/data`. Nas variáveis do serviço, configure `DATA_DIR=/data`. Isso mantém pedidos e tokens de download entre novos deploys.
6. Configure estas variáveis no Railway (não no GitHub): `NODE_ENV=production`, `DATA_DIR=/data`, `BASE_URL=https://SEU-DOMINIO.up.railway.app`, `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID` e `PAYPAL_CLIENT_SECRET` com credenciais sandbox, `ADMIN_TOKEN` com um segredo aleatório longo.
7. Faça primeiro o deploy sem SMTP se necessário, mas a entrega automática por e-mail não estará operacional. Configure depois `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM` com dados de um provedor de e-mail autorizado. Nunca use sua senha normal de e-mail se o provedor oferecer senha de app.
8. Verifique os logs e abra o domínio. Faça a compra de teste com uma conta pessoal Sandbox PayPal e credenciais de aplicativo Sandbox. Não use dinheiro real.
9. Não mude para credenciais `live` até validar checkout, persistência do banco, e-mail e download; publicar o endereço não significa que o fluxo comercial esteja pronto.

**Limitação importante:** esta versão inicial ainda não inclui webhook PayPal validado, nem um fluxo administrativo completo de reenvio de e-mail. Antes de receber pagamentos reais, faça uma revisão técnica de produção e teste recuperação de falhas. O banco SQLite deve ficar no volume `/data`; não remova esse volume, pois contém os pedidos.

## Antes de produção — obrigatório
- Criar app REST no PayPal Developer Dashboard e testar primeiro no sandbox.
- Conferir elegibilidade da conta brasileira, moedas, tarifas, impostos e termos de uso aplicáveis a downloads digitais.
- Configurar `PAYPAL_ENV=live` e credenciais LIVE somente depois de aprovação e testes completos.
- Configure `BASE_URL` para o domínio HTTPS real.
- Configure SMTP e teste recebimento, spam, bounce e reenvio de entrega.
- Criar e publicar termos de venda, política de privacidade, política de reembolso, contato e identificação comercial necessária.
- Avaliar adequação da implementação com desenvolvedor antes de produção. A versão atual captura o pagamento na rota de aprovação e valida status/valor/produto; para operação robusta, adicione webhook PayPal validado criptograficamente, idempotência completa, monitoramento e fluxo seguro de reenvio de e-mail.
- Configure backups, logs sem dados sensíveis, limite de tentativas e alertas.
- Não publique `.env`, credenciais, banco de dados ou PDFs privados em repositórios públicos.
- A pasta `private/downloads` não deve ser servida por um CDN ou servidor estático. O servidor Express serve os PDFs apenas pela rota de download com token.
- O token de download é de uso único e expira em 48 horas. Se o cliente perde o link, crie um fluxo seguro de reenvio após confirmar a compra.

## Arquitetura da entrega
1. O navegador envia e-mail para criar pedido.
2. O servidor cria o pedido com preço definido no servidor (não confia em preço enviado pelo cliente).
3. O comprador aprova o checkout PayPal.
4. O servidor captura e valida status, moeda, valor e identificador do produto.
5. O servidor cria links de uso único e tenta enviar e-mail.
6. O comprador baixa o PDF por uma rota autenticada por token.

## Observação de preço
US$ 7.90 é uma hipótese de teste definida pelo proprietário, não um preço validado pelo mercado. Antes de vender, reveja conteúdo, gramática, qualidade do PDF, preço final e obrigações legais/fiscais.
