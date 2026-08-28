# BTMOB • Hostinger com instalador de primeiro acesso

## Publicação
1. Crie um Node.js Web App na Hostinger.
2. Envie este projeto/ZIP.
3. Use Node.js 20 ou superior.
4. Build: `npm install`
5. Start: `npm start`
6. Entry point: `server.js`
7. Aponte o domínio/subdomínio para a aplicação.

## Primeiro acesso
Abra o domínio. Se ainda não houver configuração, o sistema redirecionará para `/install`.

No instalador, escolha usuário e senha do administrador. Ao concluir, ele cria `data/config.json` e as pastas `uploads/`, `builds/` e `data/`.

## Variáveis opcionais
`PORT` é fornecida pela Hostinger. Você pode definir `ADMIN_USER` e `ADMIN_PASS` para usar credenciais de ambiente; se não definir, a configuração criada pelo instalador será usada.

## Importante
O backend recebe o APK e executa um processamento demonstrativo seguro que preserva o arquivo enviado. Ele não injeta código nem modifica APKs de terceiros.
