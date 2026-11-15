# Bot de Influenciadores para Discord

## O que ele faz
- `!painel`: envia o painel de publicação (somente administradores).
- Membros com o cargo de configuração podem editar o título, a descrição, banner, thumbnail, rodapé, canal de publicação e cor dos botões.
- Botão "Publicar vídeo": abre formulário com links opcionais do TikTok e Instagram e anexo obrigatório de vídeo.
- O bot publica o vídeo enviado no canal configurado e identifica quem enviou.
- O cartão tem vídeo dentro de um container preto, nick do Discord, botões para TikTok e Instagram e contagem de curtidas.
- O botão "Ver curtidas" abre uma lista paginada com menções, sem notificar as pessoas.
- Botões para curtir/descurtir, comentar e ver os 10 comentários mais recentes.
- Curtidas e comentários ficam salvos em SQLite (`influenciadores.sqlite`).
- `!emj emoji nome` ou `!emj figurinha nome tag` adiciona um arquivo anexado ao servidor (somente conteúdo próprio ou autorizado; requer **Gerenciar expressões**).
- Ao iniciar, o bot entra sem áudio na call `1571359738682286161` e tenta reconectar automaticamente se for desconectado.
- `/mute` silencia um membro no chat e na voz sem desconectá-lo, envia o motivo por DM, aplica o cargo de mute e registra motivo e vencimento; `/unmute` remove o mute antecipadamente.
- Registra entradas de membros e criação de convites no canal `1571282224660357182`, incluindo o criador do convite quando identificável.

## Instalação
1. Instale Node.js 22 LTS ou 24 LTS.
2. Extraia o ZIP.
3. Crie um arquivo `.env` na pasta do projeto e preencha `DISCORD_TOKEN` e `GUILD_ID`. `POST_CHANNEL_ID` é opcional. O ID do aplicativo é obtido automaticamente do bot autenticado. Use somente um token recém-gerado; nunca compartilhe ou versione o arquivo `.env`.
4. No Discord Developer Portal, ative **Message Content Intent** e **Server Members Intent** em Bot > Privileged Gateway Intents.
5. Convide o bot com os escopos `bot` e `applications.commands`.
6. Permissões recomendadas: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Connect, Mute Members, Manage Roles e Manage Server. Para `!emj`, o usuário e o bot também precisam de **Manage Expressions**.
7. No terminal, dentro da pasta, execute:
   ```bash
   npm install
   npm start
   ```
8. No servidor, um administrador usa `!painel` para enviar o painel.

## Configuração pelo Discord
- Um membro com o cargo `1570091171848392825` usa `/configurar-painel` ou `!painel configurar`.
- O menu permite editar título, descrição, rodapé, banner, thumbnail e canal de publicações.
- A cor dos botões pode ser azul, cinza, verde ou vermelho.
- As alterações são salvas por servidor no SQLite e aplicadas automaticamente aos painéis e publicações existentes; não é necessário executar `!painel` novamente.
- O destaque dos cartões de publicação e a cor padrão do painel são pretos.

## Embeds personalizados
- Administradores podem usar `/embed` para enviar um embed com mensagem obrigatória e título, banner, thumbnail, rodapé, autor, cor hexadecimal, canal de destino e convite do servidor opcionais.
- Banner e thumbnail devem ser URLs HTTPS. Se nenhum canal for informado, o embed é enviado no canal em que o comando foi usado.
- Todo embed inclui um botão **Discord** com o emoji do servidor e o convite `https://discord.gg/KY4AEkxEeT`; a opção `convite` pode substituir o link nesse envio.
- O bot precisa das permissões **View Channel**, **Send Messages** e **Embed Links** no canal de destino.

## Moderação
- Moderadores com **Moderate Members** podem usar `/mute membro:<menção ou ID> tempo:<1h ou 2d> motivo:<texto>`. O limite continua sendo 28 dias.
- O bot aplica mute de voz do servidor sem desconectar a pessoa, adiciona o cargo `1571368553926369361`, envia o motivo e o vencimento por DM e registra a ação no canal `1571282224660357182`.
- Para bloquear mensagens, configure o cargo de mute para negar **Send Messages** e **Send Messages in Threads** nos canais de texto; para manter a pessoa conectada e sem falar, negue **Speak**, mas não **Connect**, nos canais de voz.
- `/unmute membro:<menção ou ID>` remove o cargo e o mute de voz aplicado pelo bot antes do vencimento. Se a pessoa fechar as DMs, o bot informa o moderador que não conseguiu enviar a mensagem privada.
- Ao vencer o tempo ou usar `/unmute`, o bot remove o cargo `1571368553926369361`, mesmo que ele já estivesse no membro antes do `/mute`.
- O cargo mais alto do bot precisa ficar acima do cargo de mute e dos membros moderados.
- O bot precisa das permissões **Mute Members** e **Manage Roles**; moderadores precisam de **Moderate Members**.

## Entradas e convites
- Cada entrada humana gera um registro no canal `1571282224660357182`, com o membro e o criador do convite quando o uso de um convite específico puder ser identificado.
- A criação de cada convite também é registrada com quem o criou, o canal, o link, o limite de usos e a validade. O bot não consegue detectar onde ou para quem alguém compartilhou o link fora do Discord.
- Para rastrear convites, ative **Server Members Intent** e conceda ao bot **Manage Server**. Entradas por convite personalizado ou com vários convites usados simultaneamente podem aparecer como "Não identificado".

## Deploy no Render
O arquivo `render.yaml` define um Background Worker e um disco persistente para o SQLite (`/var/data`). Conecte este repositório no Render, preencha `DISCORD_TOKEN` e `GUILD_ID` nas variáveis de ambiente do serviço e faça o deploy. `POST_CHANNEL_ID` pode ser definido agora ou configurado no Discord com `!painel configurar canal #publicacoes`.

Nunca salve tokens em arquivos do repositório. Como o token anterior foi exposto, revogue-o no Discord Developer Portal e gere um novo antes de iniciar o serviço.

## Importante
- O formulário do Discord coleta os links e o vídeo de uma vez; use MP4, MOV, WEBM ou M4V.
- O bot precisa ter acesso ao canal de publicações.
- Para `!emj`, anexe o arquivo ao comando: emoji aceita PNG/JPG/GIF até 256 KB; figurinha aceita PNG/APNG/JSON/GIF até 512 KB. Exemplo: `!emj figurinha ola wave`.
- Em hospedagens como Render, use disco persistente para o arquivo `influenciadores.sqlite`; sem disco persistente, o banco pode ser perdido em novos deploys/reinicializações.
- O bot não aplica timeout nativo para os novos mutes; o bloqueio de texto depende das permissões do cargo de mute nos canais.
