# Bot de Influenciadores para Discord

## O que ele faz
- `!painel`: envia o painel de publicação (somente administradores).
- Administradores podem configurar o canal de publicação, o título, a descrição e a cor do painel pelo Discord.
- Botão "Publicar vídeo": abre formulário com links opcionais do TikTok e Instagram.
- Depois do formulário, a pessoa envia o vídeo como anexo no mesmo canal em até 5 minutos.
- O bot publica no canal configurado e identifica quem enviou.
- Botões para curtir/descurtir, comentar e ver os 10 comentários mais recentes.
- Curtidas e comentários ficam salvos em SQLite (`influenciadores.sqlite`).

## Instalação
1. Instale Node.js 20 ou superior.
2. Extraia o ZIP.
3. Renomeie `.env.example` para `.env` e preencha `DISCORD_TOKEN`, `CLIENT_ID` e `GUILD_ID`. `POST_CHANNEL_ID` é opcional.
4. No Discord Developer Portal, ative **Message Content Intent** em Bot > Privileged Gateway Intents.
5. Convide o bot com os escopos `bot` e `applications.commands`.
6. Permissões recomendadas: View Channels, Send Messages, Embed Links, Attach Files, Read Message History.
7. No terminal, dentro da pasta, execute:
   ```bash
   npm install
   npm start
   ```
8. No servidor, um administrador usa `!painel`.

## Configuração pelo Discord
- `!painel configurar canal #publicacoes`
- `!painel configurar titulo Meu painel`
- `!painel configurar descricao Texto exibido no painel`
- `!painel configurar cor #9B59B6`

As configurações são salvas por servidor no SQLite. Depois de ajustar título, descrição ou cor, use `!painel` para publicar um painel com os valores atualizados.

## Deploy no Render
O arquivo `render.yaml` define um Background Worker e um disco persistente para o SQLite (`/var/data`). Conecte este repositório no Render, preencha `DISCORD_TOKEN`, `CLIENT_ID` e `GUILD_ID` nas variáveis de ambiente do serviço e faça o deploy. `POST_CHANNEL_ID` pode ser definido agora ou configurado no Discord com `!painel configurar canal #publicacoes`.

Nunca salve tokens em arquivos do repositório. Como o token anterior foi exposto, revogue-o no Discord Developer Portal e gere um novo antes de iniciar o serviço.

## Importante
- O formulário do Discord coleta os links; em seguida, anexe o vídeo em uma mensagem separada no mesmo canal, em até cinco minutos.
- O bot precisa ter acesso ao canal em que a pessoa envia o vídeo e ao canal de publicações.
- Em hospedagens como Render, use disco persistente para o arquivo `influenciadores.sqlite`; sem disco persistente, o banco pode ser perdido em novos deploys/reinicializações.
- Este é um projeto-base. Adicione moderação e limites de uso conforme as regras do seu servidor.
