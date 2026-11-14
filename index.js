require("dotenv").config();

const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, AttachmentBuilder, PermissionFlagsBits
} = require("discord.js");
const Database = require("better-sqlite3");

const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Está faltando a variável ${key} no arquivo .env`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const db = new Database(process.env.DATABASE_PATH || "influenciadores.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    author_id TEXT NOT NULL,
    video_url TEXT NOT NULL,
    video_name TEXT NOT NULL,
    tiktok_url TEXT,
    instagram_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS likes (
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    PRIMARY KEY (guild_id, setting_key)
  );
`);

const pendingVideos = new Map();
const defaultPanelTitle = "Painel de Influenciadores";
const defaultPanelDescription =
  "Clique no botão para enviar sua publicação. Informe seus links do TikTok e Instagram e, em seguida, anexe o vídeo neste canal.";
const defaultPanelColor = 0x9b59b6;

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Envia o painel para publicar vídeos")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

function getGuildConfig(guildId) {
  const rows = db.prepare(
    "SELECT setting_key, setting_value FROM guild_settings WHERE guild_id = ?"
  ).all(guildId);
  const settings = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
  return {
    postChannelId: settings.post_channel_id || process.env.POST_CHANNEL_ID,
    panelTitle: settings.panel_title || defaultPanelTitle,
    panelDescription: settings.panel_description || defaultPanelDescription,
    panelColor: settings.panel_color ? Number.parseInt(settings.panel_color, 16) : defaultPanelColor
  };
}

function setGuildSetting(guildId, key, value) {
  db.prepare(`
    INSERT INTO guild_settings (guild_id, setting_key, setting_value)
    VALUES (?, ?, ?)
    ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value
  `).run(guildId, key, value);
}

function createPanelPayload(guildId) {
  const config = getGuildConfig(guildId);
  const embed = new EmbedBuilder()
    .setColor(config.panelColor)
    .setTitle(config.panelTitle)
    .setDescription(config.panelDescription)
    .setFooter({ text: "Publique apenas vídeos que você tem autorização para divulgar." });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_publish")
      .setLabel("Publicar vídeo")
      .setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

function isValidSocialUrl(value, host) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === host || url.hostname.endsWith("." + host));
  } catch {
    return false;
  }
}

function postButtons(postId, tiktokUrl, instagramUrl) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`like:${postId}`)
      .setLabel("Curtir")
      .setEmoji("❤️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`comment:${postId}`)
      .setLabel("Comentar")
      .setEmoji("💬")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`viewcomments:${postId}`)
      .setLabel("Ver comentários")
      .setEmoji("🗨️")
      .setStyle(ButtonStyle.Secondary)
  );

  const rows = [row];
  const socials = [];
  if (tiktokUrl) socials.push(new ButtonBuilder()
    .setLabel("TikTok").setEmoji("🎵").setStyle(ButtonStyle.Link).setURL(tiktokUrl));
  if (instagramUrl) socials.push(new ButtonBuilder()
    .setLabel("Instagram").setEmoji("📸").setStyle(ButtonStyle.Link).setURL(instagramUrl));
  if (socials.length) rows.push(new ActionRowBuilder().addComponents(...socials));
  return rows;
}

function getLikeCount(postId) {
  return db.prepare("SELECT COUNT(*) AS total FROM likes WHERE post_id = ?").get(postId).total;
}

function getCommentCount(postId) {
  return db.prepare("SELECT COUNT(*) AS total FROM comments WHERE post_id = ?").get(postId).total;
}

async function refreshPost(postId) {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
  if (!post || !post.message_id) return;

  try {
    const channel = await client.channels.fetch(post.channel_id);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(post.message_id);
    const embed = EmbedBuilder.from(message.embeds[0])
      .setFields(
        { name: "Curtidas", value: `❤️ ${getLikeCount(postId)}`, inline: true },
        { name: "Comentários", value: `💬 ${getCommentCount(postId)}`, inline: true }
      );
    await message.edit({
      embeds: [embed],
      components: postButtons(postId, post.tiktok_url, post.instagram_url)
    });
  } catch (error) {
    console.error("Não foi possível atualizar a publicação:", error.message);
  }
}

client.once("ready", async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );
    console.log("Comando /painel registrado.");
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "painel") {
      if (!interaction.inGuild() ||
          !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "Somente administradores podem usar este comando.", ephemeral: true });
      }

      await interaction.reply({ content: "Painel enviado.", ephemeral: true });
      await interaction.channel.send(createPanelPayload(interaction.guildId));
      return;
    }

    if (interaction.isButton() && interaction.customId === "open_publish") {
      const modal = new ModalBuilder()
        .setCustomId("publish_modal")
        .setTitle("Enviar publicação");

      const tiktok = new TextInputBuilder()
        .setCustomId("tiktok")
        .setLabel("Link do TikTok (opcional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setPlaceholder("https://www.tiktok.com/@usuario/video/...");

      const instagram = new TextInputBuilder()
        .setCustomId("instagram")
        .setLabel("Link do Instagram (opcional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setPlaceholder("https://www.instagram.com/...");

      modal.addComponents(
        new ActionRowBuilder().addComponents(tiktok),
        new ActionRowBuilder().addComponents(instagram)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "publish_modal") {
      const tiktokUrl = interaction.fields.getTextInputValue("tiktok").trim();
      const instagramUrl = interaction.fields.getTextInputValue("instagram").trim();

      if (!isValidSocialUrl(tiktokUrl, "tiktok.com")) {
        return interaction.reply({ content: "O link do TikTok não parece válido.", ephemeral: true });
      }
      if (!isValidSocialUrl(instagramUrl, "instagram.com")) {
        return interaction.reply({ content: "O link do Instagram não parece válido.", ephemeral: true });
      }

      const key = `${interaction.guildId}:${interaction.user.id}`;
      if (pendingVideos.has(key)) {
        clearTimeout(pendingVideos.get(key).timeout);
        pendingVideos.delete(key);
      }

      const timeout = setTimeout(() => pendingVideos.delete(key), 5 * 60 * 1000);
      pendingVideos.set(key, {
        guildId: interaction.guildId,
        sourceChannelId: interaction.channelId,
        userId: interaction.user.id,
        tiktokUrl,
        instagramUrl,
        timeout
      });

      await interaction.reply({
        content: "Agora envie **o vídeo como anexo neste canal** em até 5 minutos. O bot identificará você automaticamente.",
        ephemeral: true
      });
      return;
    }

    if (interaction.isButton()) {
      const [action, idText] = interaction.customId.split(":");
      const postId = Number(idText);
      if (!Number.isInteger(postId)) return;

      const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
      if (!post) {
        return interaction.reply({ content: "Essa publicação não foi encontrada.", ephemeral: true });
      }

      if (action === "like") {
        const existing = db.prepare(
          "SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?"
        ).get(postId, interaction.user.id);

        if (existing) {
          db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?")
            .run(postId, interaction.user.id);
        } else {
          db.prepare("INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)")
            .run(postId, interaction.user.id);
        }

        await refreshPost(postId);
        await interaction.reply({
          content: existing ? "Você removeu sua curtida." : "Você curtiu esta publicação! ❤️",
          ephemeral: true
        });
        return;
      }

      if (action === "comment") {
        const modal = new ModalBuilder()
          .setCustomId(`comment_modal:${postId}`)
          .setTitle("Adicionar comentário");

        const input = new TextInputBuilder()
          .setCustomId("comment_text")
          .setLabel("Escreva seu comentário")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(800)
          .setPlaceholder("Digite seu comentário...");

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (action === "viewcomments") {
        const comments = db.prepare(
          "SELECT user_id, content, created_at FROM comments WHERE post_id = ? ORDER BY id DESC LIMIT 10"
        ).all(postId).reverse();

        if (!comments.length) {
          return interaction.reply({ content: "Ainda não há comentários nesta publicação.", ephemeral: true });
        }

        const description = comments.map(c =>
          `**<@${c.user_id}>**\n${c.content.replace(/@everyone|@here/g, "@​$&")}`
        ).join("\n\n").slice(0, 4000);

        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(`💬 Comentários da publicação #${postId}`)
          .setDescription(description)
          .setFooter({ text: "Mostrando os 10 comentários mais recentes." });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("comment_modal:")) {
      const postId = Number(interaction.customId.split(":")[1]);
      const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
      if (!post) {
        return interaction.reply({ content: "Essa publicação não foi encontrada.", ephemeral: true });
      }

      const content = interaction.fields.getTextInputValue("comment_text").trim();
      if (!content) {
        return interaction.reply({ content: "O comentário não pode ficar vazio.", ephemeral: true });
      }

      db.prepare("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)")
        .run(postId, interaction.user.id, content);

      await refreshPost(postId);
      await interaction.reply({ content: "Comentário publicado! 💬", ephemeral: true });
      return;
    }
  } catch (error) {
    console.error("Erro ao processar interação:", error);
    const message = "Ocorreu um erro ao processar essa ação.";
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const command = message.content.match(/^!painel(?:\s+([\s\S]*))?$/i);
  if (command) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("Somente administradores podem usar este comando.");
      return;
    }

    const args = (command[1] || "").trim();
    const configMatch = args.match(/^configurar(?:\s+([\s\S]*))?$/i);
    if (configMatch) {
      const setting = (configMatch[1] || "").trim();
      const [name, ...valueParts] = setting.split(/\s+/);
      const value = valueParts.join(" ").trim();
      const settingNames = {
        canal: "post_channel_id",
        titulo: "panel_title",
        descricao: "panel_description",
        cor: "panel_color"
      };
      const settingKey = name && Object.prototype.hasOwnProperty.call(settingNames, name.toLowerCase())
        ? settingNames[name.toLowerCase()]
        : null;

      if (!settingKey || !value) {
        await message.reply(
          "Uso: `!painel configurar canal #canal`, `titulo <texto>`, `descricao <texto>` ou `cor #RRGGBB`."
        );
        return;
      }

      const key = settingKey;
      if (key === "post_channel_id") {
        const channelId = value.match(/^<#(\d+)>$/)?.[1] || value;
        if (!/^\d{17,20}$/.test(channelId)) {
          await message.reply("Informe um canal de texto válido, por exemplo: `!painel configurar canal #publicações`.");
          return;
        }
        let channel;
        try {
          channel = await message.guild.channels.fetch(channelId);
        } catch (error) {
          console.error("Erro ao buscar canal de publicacoes:", error);
          await message.reply("Não foi possível acessar esse canal. Verifique o ID e as permissões do bot.");
          return;
        }
        if (!channel || !channel.isTextBased()) {
          await message.reply("O canal informado não existe ou não aceita mensagens.");
          return;
        }
        setGuildSetting(message.guild.id, key, channel.id);
        await message.reply(`Canal de publicações definido para <#${channel.id}>.`);
        return;
      }

      if (key === "panel_title" && value.length > 256) {
        await message.reply("O título pode ter no máximo 256 caracteres.");
        return;
      }
      if (key === "panel_description" && value.length > 4000) {
        await message.reply("A descrição pode ter no máximo 4000 caracteres.");
        return;
      }
      if (key === "panel_color" && !/^#?[0-9a-f]{6}$/i.test(value)) {
        await message.reply("A cor deve estar no formato `#RRGGBB`, por exemplo `#9B59B6`.");
        return;
      }

      setGuildSetting(
        message.guild.id,
        key,
        key === "panel_color" ? value.replace(/^#/, "").toLowerCase() : value
      );
      await message.reply("Configuração do painel atualizada.");
      return;
    }

    await message.channel.send(createPanelPayload(message.guild.id));
    return;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const pending = pendingVideos.get(key);
  if (!pending) return;
  if (message.channel.id !== pending.sourceChannelId) return;

  const attachment = message.attachments.find(a =>
    (a.contentType && a.contentType.startsWith("video/")) ||
    /\.(mp4|mov|webm|m4v)$/i.test(a.name || "")
  );

  if (!attachment) return;

  clearTimeout(pending.timeout);
  pendingVideos.delete(key);

  try {
    const postChannelId = getGuildConfig(message.guild.id).postChannelId;
    if (!postChannelId) {
      await message.reply("Nenhum canal de publicações foi configurado. Peça a um administrador para usar `!painel configurar canal #canal`.");
      return;
    }
    const postChannel = await client.channels.fetch(postChannelId);
    if (!postChannel || !postChannel.isTextBased()) {
      return message.reply("O canal de publicações configurado não foi encontrado.");
    }

    const postInfo = db.prepare(`
      INSERT INTO posts (guild_id, channel_id, author_id, video_url, video_name, tiktok_url, instagram_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.guild.id,
      postChannel.id,
      message.author.id,
      attachment.url,
      attachment.name || "video.mp4",
      pending.tiktokUrl,
      pending.instagramUrl
    );

    const postId = Number(postInfo.lastInsertRowid);
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setAuthor({
        name: `Publicado por ${message.author.username}`,
        iconURL: message.author.displayAvatarURL()
      })
      .setDescription(`**Influencer:** <@${message.author.id}>`)
      .addFields(
        { name: "Curtidas", value: "❤️ 0", inline: true },
        { name: "Comentários", value: "💬 0", inline: true }
      )
      .setFooter({ text: `Publicação #${postId}` })
      .setTimestamp();

    const videoResponse = await fetch(attachment.url);
    if (!videoResponse.ok) throw new Error("Não foi possível baixar o vídeo anexado.");
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

    const sent = await postChannel.send({
      content: `Nova publicação de <@${message.author.id}>`,
      embeds: [embed],
      files: [new AttachmentBuilder(videoBuffer, { name: attachment.name || "video.mp4" })],
      components: postButtons(postId, pending.tiktokUrl, pending.instagramUrl),
      allowedMentions: { users: [message.author.id] }
    });

    db.prepare("UPDATE posts SET message_id = ? WHERE id = ?").run(sent.id, postId);
    await message.reply("Seu vídeo foi publicado com sucesso! 🎉");
  } catch (error) {
    console.error("Erro ao publicar vídeo:", error);
    await message.reply("Não consegui publicar o vídeo. Verifique as permissões e o limite de tamanho do Discord.");
  }
});

client.login(process.env.DISCORD_TOKEN);
