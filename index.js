require("dotenv").config();

const http = require("node:http");
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ChannelType,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, AttachmentBuilder, FileUploadBuilder, LabelBuilder,
  ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  TextDisplayBuilder, StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits
} = require("discord.js");
const Database = require("better-sqlite3");
const {
  entersState, joinVoiceChannel, VoiceConnectionStatus
} = require("@discordjs/voice");

const required = ["DISCORD_TOKEN", "GUILD_ID"];
const voiceChannelId = "1571359738682286161";
const tinderProfileChannelId = "1570582366630576220";
const hourlyRoleMentionChannelId = "1571687956459159632";
const hourlyRoleMentionRoleId = "1570576646468276336";
const hourlyRoleMentionIntervalMs = 60 * 60 * 1000;
const maxTinderMediaSize = 25 * 1024 * 1024;
const tinderGenders = ["Homem", "Mulher", "Não binário", "Outro", "Prefiro não informar"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Está faltando a variável ${key}. Configure-a no ambiente ou no arquivo .env local.`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
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
    discord_nick TEXT NOT NULL DEFAULT '',
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
  CREATE TABLE IF NOT EXISTS panel_messages (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, message_id)
  );
  CREATE TABLE IF NOT EXISTS active_mutes (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    role_added_by_bot INTEGER NOT NULL,
    voice_mute_added_by_bot INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS guild_invite_uses (
    guild_id TEXT NOT NULL,
    invite_code TEXT NOT NULL,
    uses INTEGER NOT NULL,
    PRIMARY KEY (guild_id, invite_code)
  );
  CREATE TABLE IF NOT EXISTS live_status_messages (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    banner_url TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS guild_member_joins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_guild_member_joins_guild_time
    ON guild_member_joins (guild_id, joined_at);
  CREATE TABLE IF NOT EXISTS tinder_profiles (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    profile_channel_id TEXT NOT NULL,
    profile_message_id TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL,
    age INTEGER NOT NULL,
    city TEXT NOT NULL,
    media_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS tinder_panel_messages (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tinder_panel_settings (
    guild_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    color INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tinder_match_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    request_channel_id TEXT,
    request_message_id TEXT,
    private_channel_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, sender_id, recipient_id)
  );
  CREATE TABLE IF NOT EXISTS tinder_swipes (
    guild_id TEXT NOT NULL,
    swiper_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, swiper_id, target_id)
  );
  CREATE TABLE IF NOT EXISTS server_tag_panels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    required_tag TEXT NOT NULL,
    role_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    color INTEGER NOT NULL DEFAULT 5793266,
    banner_url TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS server_tag_verifications (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS scheduled_role_mentions (
    task_key TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sent_at INTEGER NOT NULL
  );
`);

const activeMuteColumns = db.pragma("table_info(active_mutes)");
if (!activeMuteColumns.some(column => column.name === "voice_mute_added_by_bot")) {
  db.exec("ALTER TABLE active_mutes ADD COLUMN voice_mute_added_by_bot INTEGER");
}

const postColumns = db.pragma("table_info(posts)");
if (!postColumns.some(column => column.name === "discord_nick")) {
  db.exec("ALTER TABLE posts ADD COLUMN discord_nick TEXT NOT NULL DEFAULT ''");
}

const serverTagPanelColumns = db.pragma("table_info(server_tag_panels)");
for (const [name, definition] of [
  ["title", "TEXT NOT NULL DEFAULT ''"],
  ["description", "TEXT NOT NULL DEFAULT ''"],
  ["color", "INTEGER NOT NULL DEFAULT 5793266"],
  ["banner_url", "TEXT NOT NULL DEFAULT ''"],
  ["thumbnail_url", "TEXT NOT NULL DEFAULT ''"]
]) {
  if (!serverTagPanelColumns.some(column => column.name === name)) {
    db.exec(`ALTER TABLE server_tag_panels ADD COLUMN ${name} ${definition}`);
  }
}

const defaultPanelTitle = "Painel de Influenciadores";
const defaultPanelDescription =
  "Clique no botão para enviar sua publicação. Informe seus links do TikTok e Instagram e anexe o vídeo no formulário.";
const defaultPanelFooter = "Publique apenas vídeos que você tem autorização para divulgar.";
const defaultPanelColor = 0x000000;
const defaultDiscordInviteUrl = "https://discord.gg/KY4AEkxEeT";
const configRoleId = "1570091171848392825";
const muteRoleId = "1571368553926369361";
const defaultServerTagRoleId = "1570583048569888889";
const muteLogChannelId = "1571282224660357182";
const serverTagLogChannelId = "1571686069819285504";
const maxMuteDurationMs = 28 * 24 * 60 * 60 * 1000;
let voiceConnection;
let voiceReconnectTimer;
let serverTagAuditRunning = false;
let hourlyRoleMentionTimer;
let hourlyRoleMentionRunning = false;
const liveStatusMessageCache = new Map();
const previousVoiceCounts = new Map();
let liveStatusUpdateRunning = false;
let lastRecentJoinCleanupAt = 0;
const buttonStyles = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger
};

db.prepare(`
  UPDATE guild_settings SET setting_value = '000000'
  WHERE setting_key = 'panel_color' AND lower(setting_value) = '9b59b6'
`).run();

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Envia o painel para publicar vídeos")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("configurar-painel")
    .setDescription("Abre as configurações do painel"),
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Cria um embed personalizado")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option
      .setName("mensagem")
      .setDescription("Texto principal do embed")
      .setRequired(true)
      .setMaxLength(4096))
    .addStringOption(option => option
      .setName("titulo")
      .setDescription("Título do embed")
      .setRequired(false)
      .setMaxLength(256))
    .addStringOption(option => option
      .setName("banner")
      .setDescription("URL HTTPS da imagem grande")
      .setRequired(false)
      .setMaxLength(1000))
    .addStringOption(option => option
      .setName("thumbnail")
      .setDescription("URL HTTPS da miniatura")
      .setRequired(false)
      .setMaxLength(1000))
    .addStringOption(option => option
      .setName("rodape")
      .setDescription("Texto do rodapé")
      .setRequired(false)
      .setMaxLength(2048))
    .addStringOption(option => option
      .setName("autor")
      .setDescription("Nome do autor exibido no embed")
      .setRequired(false)
      .setMaxLength(256))
    .addStringOption(option => option
      .setName("cor")
      .setDescription("Cor hexadecimal, por exemplo #000000")
      .setRequired(false)
      .setMaxLength(7))
    .addChannelOption(option => option
      .setName("canal")
      .setDescription("Canal de destino (padrão: canal atual)")
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(option => option
      .setName("convite")
      .setDescription("Link do servidor para o botão Discord (padrão: convite configurado)")
      .setRequired(false)
      .setMaxLength(256)),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Cria ou atualiza o painel de atividade das calls")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option => option
      .setName("canal")
      .setDescription("Canal de destino (padrão: canal atual)")
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(option => option
      .setName("banner")
      .setDescription("URL HTTPS opcional da imagem do painel")
      .setRequired(false)
      .setMaxLength(1000)),
  new SlashCommandBuilder()
    .setName("tinder")
    .setDescription("Configura o painel de perfis e matches")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand => subcommand
      .setName("painel")
      .setDescription("Cria ou atualiza o painel do Tinder")
      .addChannelOption(option => option
        .setName("canal")
        .setDescription("Canal onde o painel ficará (padrão: canal atual)")
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption(option => option
        .setName("titulo")
        .setDescription("Novo título do painel")
        .setRequired(false)
        .setMaxLength(256))
      .addStringOption(option => option
        .setName("descricao")
        .setDescription("Nova descrição do painel")
        .setRequired(false)
        .setMaxLength(1000))
      .addStringOption(option => option
        .setName("cor")
        .setDescription("Nova cor hexadecimal, por exemplo #EB459E")
        .setRequired(false)
        .setMaxLength(7))),
  new SlashCommandBuilder()
    .setName("verificacao-tag")
    .setDescription("Configura o painel de verificação da tag do servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand => subcommand
        .setName("painel")
        .setDescription("Cria ou atualiza o painel de verificação")
        .addStringOption(option => option
          .setName("tag")
          .setDescription("Texto da tag no perfil do Discord (padrão: RFF; não é o cargo)")
          .setRequired(false)
          .setMaxLength(4))
        .addRoleOption(option => option
          .setName("cargo")
          .setDescription("Cargo concedido após verificar (padrão: cargo configurado)")
          .setRequired(false))
        .addChannelOption(option => option
          .setName("canal")
          .setDescription("Canal do painel (padrão: canal atual)")
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
          .addStringOption(option => option
            .setName("titulo")
            .setDescription("Título do painel")
            .setRequired(false)
            .setMaxLength(256))
          .addStringOption(option => option
            .setName("descricao")
            .setDescription("Descrição do painel")
            .setRequired(false)
            .setMaxLength(4000))
          .addStringOption(option => option
            .setName("banner")
            .setDescription("URL HTTPS do banner; use remover para limpar")
            .setRequired(false)
            .setMaxLength(1000))
          .addStringOption(option => option
            .setName("thumbnail")
            .setDescription("URL HTTPS da thumbnail; use remover para limpar")
            .setRequired(false)
            .setMaxLength(1000))
          .addStringOption(option => option
            .setName("cor")
            .setDescription("Cor hexadecimal, por exemplo #E74C3C")
            .setRequired(false)
            .setMaxLength(7))),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Silencia um membro temporariamente sem removê-lo da call")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(option => option
      .setName("membro")
      .setDescription("Menção ou ID do membro")
      .setRequired(true)
      .setMaxLength(30))
    .addStringOption(option => option
      .setName("tempo")
      .setDescription("Duração, por exemplo 1h ou 2d (máximo 28d)")
      .setRequired(true)
      .setMaxLength(4))
    .addStringOption(option => option
      .setName("motivo")
      .setDescription("Motivo do mute")
      .setRequired(true)
      .setMaxLength(512)),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove o mute temporário de um membro")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(option => option
      .setName("membro")
      .setDescription("Menção ou ID do membro")
      .setRequired(true)
      .setMaxLength(30))
    .addStringOption(option => option
      .setName("motivo")
      .setDescription("Motivo para remover o mute")
      .setRequired(false)
      .setMaxLength(512))
];

function parseMuteDuration(value) {
  const match = /^([1-9]\d*)([hd])$/i.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const milliseconds = amount * (unit === "h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds > maxMuteDurationMs) return null;

  return { milliseconds, label: `${amount}${unit}` };
}

function scheduleVoiceReconnect() {
  if (voiceReconnectTimer) return;

  voiceReconnectTimer = setTimeout(() => {
    voiceReconnectTimer = undefined;
    connectToVoiceChannel().catch(error => {
      console.error(`Não foi possível reconectar à call ${voiceChannelId}:`, error);
    });
  }, 5_000);
  voiceReconnectTimer.unref();
}

async function connectToVoiceChannel() {
  let connection;
  try {
    const channel = await client.channels.fetch(voiceChannelId);
    if (!channel?.isVoiceBased()) {
      throw new Error(`O canal ${voiceChannelId} não existe ou não é um canal de voz.`);
    }

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true
    });
    voiceConnection = connection;
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
      } catch (error) {
        if (voiceConnection !== connection) return;
        console.error(`Desconectado da call ${voiceChannelId}; tentando reconectar:`, error);
        connection.destroy();
        voiceConnection = undefined;
        scheduleVoiceReconnect();
      }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log(`Conectado à call ${channel.name} (${channel.id}), sem áudio.`);
  } catch (error) {
    if (connection && voiceConnection === connection) {
      connection.destroy();
      voiceConnection = undefined;
    }
    console.error(`Não foi possível entrar na call ${voiceChannelId}:`, error);
    scheduleVoiceReconnect();
  }
}

function parseMemberId(value) {
  const trimmed = value.trim();
  const mention = trimmed.match(/^<@!?(\d+)>$/);
  if (mention) return mention[1];
  return /^\d{17,20}$/.test(trimmed) ? trimmed : null;
}

function createMuteLogEmbed({ guild, title, userId, moderatorId, reason, duration, expiresAt }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(title)
    .addFields(
      { name: "👤 Membro", value: `<@${userId}>`, inline: true },
      { name: "ID do membro", value: `\`${userId}\``, inline: true },
      { name: "⏳ Tempo", value: duration, inline: true },
      { name: "📝 Motivo", value: reason },
      { name: "🛡️ Moderador", value: `<@${moderatorId}>`, inline: true },
      { name: "ID do moderador", value: `\`${moderatorId}\``, inline: true }
    )
    .setFooter({ text: guild.name })
    .setTimestamp();

  if (expiresAt) {
    embed.addFields({
      name: "Vencimento",
      value: `<t:${Math.floor(expiresAt / 1000)}:F> • <t:${Math.floor(expiresAt / 1000)}:R>`
    });
  }

  return embed;
}

function createMuteDmEmbed({ guild, reason, duration, expiresAt }) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Você recebeu um silenciamento temporário")
    .setDescription(`Seu acesso foi silenciado no servidor **${guild.name}**. Você permanece na call, mas não poderá falar enquanto o mute estiver ativo.`)
    .addFields(
      { name: "Motivo", value: reason },
      { name: "Duração", value: duration },
      { name: "Vencimento", value: `<t:${Math.floor(expiresAt / 1000)}:F> • <t:${Math.floor(expiresAt / 1000)}:R>` }
    )
    .setTimestamp();
}

async function sendServerLog(guild, embed) {
  const channel = await guild.channels.fetch(muteLogChannelId);
  if (!channel?.isTextBased()) {
    throw new Error(`O canal de registro ${muteLogChannelId} não está acessível.`);
  }
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function sendHourlyRoleMention() {
  const taskKey = "hourly-role-mention";
  const channel = await client.channels.fetch(hourlyRoleMentionChannelId);
  if (!channel?.isTextBased() || !channel.guild) {
    throw new Error(`O canal ${hourlyRoleMentionChannelId} não está acessível ou não é de texto.`);
  }

  const [role, botMember] = await Promise.all([
    channel.guild.roles.fetch(hourlyRoleMentionRoleId),
    channel.guild.members.fetchMe()
  ]);
  if (!role) throw new Error(`O cargo ${hourlyRoleMentionRoleId} não existe no servidor do canal.`);
  if (!role.mentionable && !botMember.permissions.has(PermissionFlagsBits.MentionEveryone)) {
    throw new Error(`O cargo ${role.id} precisa ser mencionável ou o bot precisa da permissão Mencionar @everyone.`);
  }

  const previous = db.prepare(
    "SELECT message_id FROM scheduled_role_mentions WHERE task_key = ?"
  ).get(taskKey);
  if (previous) {
    try {
      const previousMessage = await channel.messages.fetch(previous.message_id);
      if (previousMessage.author.id !== client.user.id) {
        throw new Error(`A mensagem salva ${previous.message_id} não pertence a este bot.`);
      }
      await previousMessage.delete();
    } catch (error) {
      if (error.code !== 10008) throw error;
    }
  }

  const message = await channel.send({
    content: `<@&${role.id}>`,
    allowedMentions: { parse: [], roles: [role.id] }
  });
  try {
    db.prepare(`
      INSERT INTO scheduled_role_mentions (task_key, channel_id, message_id, sent_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(task_key) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = excluded.message_id,
        sent_at = excluded.sent_at
    `).run(taskKey, channel.id, message.id, Date.now());
  } catch (error) {
    await message.delete().catch(deleteError => {
      console.error("Não foi possível limpar o aviso após falha ao salvar seu registro:", deleteError);
    });
    throw error;
  }

  console.log(`Aviso horário publicado em ${channel.id} e menção anterior removida.`);
}

function scheduleHourlyRoleMention(delayMs) {
  if (hourlyRoleMentionTimer) clearTimeout(hourlyRoleMentionTimer);
  hourlyRoleMentionTimer = setTimeout(async () => {
    hourlyRoleMentionTimer = undefined;
    if (hourlyRoleMentionRunning) {
      scheduleHourlyRoleMention(60_000);
      return;
    }

    hourlyRoleMentionRunning = true;
    let nextDelay = hourlyRoleMentionIntervalMs;
    try {
      await sendHourlyRoleMention();
    } catch (error) {
      console.error("Não foi possível enviar o aviso horário de cargo:", error);
      nextDelay = 5 * 60_000;
    } finally {
      hourlyRoleMentionRunning = false;
      scheduleHourlyRoleMention(nextDelay);
    }
  }, Math.max(0, delayMs));
  hourlyRoleMentionTimer.unref();
}

function startHourlyRoleMentionSchedule() {
  const previous = db.prepare(
    "SELECT sent_at FROM scheduled_role_mentions WHERE task_key = ?"
  ).get("hourly-role-mention");
  const delayMs = previous
    ? Math.max(0, previous.sent_at + hourlyRoleMentionIntervalMs - Date.now())
    : 0;
  scheduleHourlyRoleMention(delayMs);
}

function saveInviteSnapshot(guildId, invites) {
  const replaceSnapshot = db.transaction(() => {
    db.prepare("DELETE FROM guild_invite_uses WHERE guild_id = ?").run(guildId);
    const insert = db.prepare(`
      INSERT INTO guild_invite_uses (guild_id, invite_code, uses)
      VALUES (?, ?, ?)
    `);
    for (const invite of invites.values()) {
      insert.run(guildId, invite.code, invite.uses || 0);
    }
  });
  replaceSnapshot();
}

function saveSingleInviteUse(guildId, invite) {
  db.prepare(`
    INSERT INTO guild_invite_uses (guild_id, invite_code, uses)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, invite_code) DO UPDATE SET uses = excluded.uses
  `).run(guildId, invite.code, invite.uses || 0);
}

async function initializeInviteSnapshots() {
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      saveInviteSnapshot(guild.id, invites);
    } catch (error) {
      db.prepare("DELETE FROM guild_invite_uses WHERE guild_id = ?").run(guild.id);
      console.error(`Não foi possível carregar os convites do servidor ${guild.id}:`, error);
    }
  }
}

async function handleGuildMemberJoin(member) {
  const joinedAt = Math.floor((member.joinedTimestamp || Date.now()) / 1000);
  db.prepare(`
    INSERT INTO guild_member_joins (guild_id, user_id, joined_at)
    VALUES (?, ?, ?)
  `).run(member.guild.id, member.id, joinedAt);
  db.prepare("DELETE FROM guild_member_joins WHERE guild_id = ? AND joined_at < ?")
    .run(member.guild.id, joinedAt - 3_600);

  let usedInvite = null;
  let inviter = null;
  try {
    await inviteSnapshotInitialization;
    const previousUses = new Map(
      db.prepare("SELECT invite_code, uses FROM guild_invite_uses WHERE guild_id = ?")
        .all(member.guild.id)
        .map(row => [row.invite_code, row.uses])
    );
    const currentInvites = await member.guild.invites.fetch();
    const increases = [...currentInvites.values()].filter(invite =>
      previousUses.has(invite.code) && (invite.uses || 0) > previousUses.get(invite.code)
    );
    if (increases.length === 1) {
      usedInvite = increases[0];
      inviter = usedInvite.inviter;
    }
    saveInviteSnapshot(member.guild.id, currentInvites);
  } catch (error) {
    db.prepare("DELETE FROM guild_invite_uses WHERE guild_id = ?").run(member.guild.id);
    console.error(`Não foi possível identificar o convite usado por ${member.id}:`, error);
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Novo membro entrou no servidor")
    .addFields(
      { name: "Membro", value: `<@${member.id}> (\`${member.id}\`)` },
      {
        name: "Convidado por",
        value: inviter ? `<@${inviter.id}> (\`${inviter.id}\`)` : "Não identificado",
        inline: true
      },
      {
        name: "Link usado",
        value: usedInvite ? `https://discord.gg/${usedInvite.code}` : "Não identificado",
        inline: true
      },
      {
        name: "Conta criada",
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
        inline: false
      }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  try {
    await sendServerLog(member.guild, embed);
  } catch (error) {
    console.error(`Não foi possível registrar a entrada de ${member.id}:`, error);
  }
}

async function handleInviteCreated(invite) {
  if (!invite.guild) return;

  saveSingleInviteUse(invite.guild.id, invite);
  const inviterId = invite.inviter?.id;
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Link de convite criado")
    .addFields(
      { name: "Criado por", value: inviterId ? `<@${inviterId}> (\`${inviterId}\`)` : "Não identificado", inline: true },
      { name: "Canal", value: invite.channelId ? `<#${invite.channelId}>` : "Não identificado", inline: true },
      { name: "Link", value: `https://discord.gg/${invite.code}` },
      { name: "Usos máximos", value: invite.maxUses ? String(invite.maxUses) : "Ilimitado", inline: true },
      {
        name: "Expira",
        value: invite.expiresTimestamp
          ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:F>`
          : "Nunca",
        inline: true
      }
    )
    .setTimestamp();

  try {
    await sendServerLog(invite.guild, embed);
  } catch (error) {
    console.error(`Não foi possível registrar a criação do convite ${invite.code}:`, error);
  }
}

let inviteSnapshotInitialization = Promise.resolve();
let inviteTrackingQueue = Promise.resolve();

async function getMuteRoleAndBotMember(guild) {
  const [role, botMember] = await Promise.all([
    guild.roles.fetch(muteRoleId),
    guild.members.fetchMe()
  ]);
  if (!role) throw new Error(`O cargo de mute ${muteRoleId} não existe neste servidor.`);
  if (!botMember.permissions.has(PermissionFlagsBits.MuteMembers)) {
    throw new Error("O bot precisa da permissão Silenciar Membros.");
  }
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("O bot precisa da permissão Gerenciar Cargos.");
  }
  if (role.position >= botMember.roles.highest.position) {
    throw new Error("Mova o cargo do bot para cima do cargo de mute.");
  }
  return { role, botMember };
}

function canModerateMember(target, moderator, botMember, guild) {
  if (target.id === guild.ownerId || target.id === botMember.id) return false;
  if (target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) return false;
  return moderator.id === guild.ownerId ||
    target.roles.highest.comparePositionTo(moderator.roles.highest) < 0;
}

function userHasServerTag(primaryGuild, requiredTag, guildId) {
  return primaryGuild?.identityGuildId === guildId &&
    primaryGuild.identityEnabled === true &&
    primaryGuild.tag?.toLocaleUpperCase("en-US") === requiredTag;
}

async function fetchUserPrimaryGuild(userId) {
  const user = await client.rest.get(Routes.user(userId));
  const primaryGuild = user.primary_guild;
  return primaryGuild
    ? {
        identityGuildId: primaryGuild.identity_guild_id,
        identityEnabled: primaryGuild.identity_enabled,
        tag: primaryGuild.tag
      }
    : null;
}

function getServerTagPanelImage(value, currentValue, label) {
  if (value === null) return currentValue || "";
  if (value.trim().toLocaleLowerCase("pt-BR") === "remover") return "";

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Informe uma URL HTTPS válida para ${label}, ou use \`remover\` para limpar.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`A URL de ${label} precisa começar com HTTPS.`);
  }
  return url.toString();
}

async function getServerTagRole(guild, roleId) {
  const [role, botMember] = await Promise.all([
    guild.roles.fetch(roleId),
    guild.members.fetchMe()
  ]);
  if (!role) throw new Error(`O cargo ${roleId} não existe neste servidor.`);
  if (role.managed || role.id === guild.id) {
    throw new Error("Escolha um cargo normal, que possa ser gerenciado pelo bot.");
  }
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("O bot precisa da permissão Gerenciar Cargos.");
  }
  if (role.position >= botMember.roles.highest.position) {
    throw new Error("Mova o cargo do bot para cima do cargo que será concedido.");
  }
  return role;
}

function createServerTagPanelPayload(guildId, requiredTag, roleId, settings) {
  const embed = new EmbedBuilder()
    .setColor(settings.color)
    .setTitle(settings.title || `Verificação da tag ${requiredTag}`)
    .setDescription(settings.description ||
      `Clique em **Verificar** para conferir se a tag **${requiredTag}** está ativa no seu perfil do Discord.\n` +
      `Quem estiver com a tag recebe <@&${roleId}>. Se retirar a tag, o cargo será removido automaticamente.`);
  if (settings.bannerUrl) embed.setImage(settings.bannerUrl);
  if (settings.thumbnailUrl) embed.setThumbnail(settings.thumbnailUrl);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`server-tag:verify:${guildId}`)
      .setLabel("Verificar")
      .setStyle(ButtonStyle.Success)
  );
  return {
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [], roles: [] }
  };
}

function logServerTagEvent(guild, member, requiredTag, roleId, result, action) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Registro • Verificação de tag")
    .addFields(
      { name: "Membro", value: `<@${member.id}> (\`${member.id}\`)`, inline: true },
      { name: "Tag exigida", value: `**${requiredTag}**`, inline: true },
      { name: "Resultado", value: result, inline: true },
      { name: "Cargo", value: `<@&${roleId}> (\`${roleId}\`)`, inline: true },
      { name: "Ação", value: action, inline: false }
    )
    .setFooter({ text: guild.name })
    .setTimestamp();

  guild.channels.fetch(serverTagLogChannelId)
    .then(channel => {
      if (!channel?.isTextBased()) {
        throw new Error(`O canal de registro ${serverTagLogChannelId} não está acessível.`);
      }
      return channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    })
    .catch(error => {
      console.error(`Não foi possível registrar a verificação de tag de ${member.id}:`, error);
    });
}

async function handleServerTagPanelCommand(interaction) {
  if (!interaction.inGuild() || !interaction.guild ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "Somente administradores podem configurar este painel.",
      ephemeral: true
    });
  }

  const existing = db.prepare(
    "SELECT channel_id, message_id, required_tag, role_id, title, description, color, banner_url, thumbnail_url " +
    "FROM server_tag_panels WHERE guild_id = ?"
  ).get(interaction.guildId);
  const requiredTag = (interaction.options.getString("tag") || existing?.required_tag || "RFF")
    .trim()
    .toLocaleUpperCase("en-US");
  if (!/^[A-Z0-9]{1,4}$/.test(requiredTag)) {
    return interaction.reply({
      content: "Informe uma tag válida com 1 a 4 letras ou números, por exemplo `RFF`.",
      ephemeral: true
    });
  }

  const channel = interaction.options.getChannel("canal") || interaction.channel;
  if (!channel?.isTextBased() || typeof channel.send !== "function" ||
      channel.guildId !== interaction.guildId) {
    return interaction.reply({ content: "Escolha um canal de texto deste servidor.", ephemeral: true });
  }

  const selectedRole = interaction.options.getRole("cargo");
  const roleId = selectedRole?.id || existing?.role_id || defaultServerTagRoleId;
  const titleOption = interaction.options.getString("titulo");
  const descriptionOption = interaction.options.getString("descricao");
  const title = titleOption === null
    ? existing?.title || ""
    : titleOption.trim().toLocaleLowerCase("pt-BR") === "remover" ? "" : titleOption.trim();
  const description = descriptionOption === null
    ? existing?.description || ""
    : descriptionOption.trim().toLocaleLowerCase("pt-BR") === "remover" ? "" : descriptionOption.trim();
  let bannerUrl;
  let thumbnailUrl;
  try {
    bannerUrl = getServerTagPanelImage(
      interaction.options.getString("banner"),
      existing?.banner_url,
      "banner"
    );
    thumbnailUrl = getServerTagPanelImage(
      interaction.options.getString("thumbnail"),
      existing?.thumbnail_url,
      "thumbnail"
    );
  } catch (error) {
    return interaction.reply({ content: error.message, ephemeral: true });
  }
  const colorOption = interaction.options.getString("cor");
  let color = existing?.color ?? 0x5865f2;
  if (colorOption !== null) {
    if (!/^#?[0-9A-Fa-f]{6}$/.test(colorOption.trim())) {
      return interaction.reply({
        content: "Informe uma cor hexadecimal de 6 dígitos, por exemplo `#E74C3C`.",
        ephemeral: true
      });
    }
    color = Number.parseInt(colorOption.trim().replace(/^#/, ""), 16);
  }
  await interaction.deferReply({ ephemeral: true });

  let role;
  try {
    role = await getServerTagRole(interaction.guild, roleId);
  } catch (error) {
    console.error("Configuração do painel de verificação de tag inválida:", error);
    return interaction.editReply(error.message);
  }

  let panelMessage;

  if (existing && existing.role_id !== role.id) {
    const storedOldRole = await interaction.guild.roles.fetch(existing.role_id);
    const oldRole = storedOldRole
      ? await getServerTagRole(interaction.guild, existing.role_id)
      : null;
    const verifiedMembers = db.prepare(
      "SELECT user_id FROM server_tag_verifications WHERE guild_id = ?"
    ).all(interaction.guildId);
    for (const verified of verifiedMembers) {
      try {
        const member = await interaction.guild.members.fetch({ user: verified.user_id, force: true });
        if (oldRole && member.roles.cache.has(oldRole.id)) {
          await member.roles.remove(oldRole, "Cargo de verificação substituído pela configuração do painel.");
        }
        db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
          .run(interaction.guildId, verified.user_id);
      } catch (error) {
        if (error.code === 10007) {
          db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
            .run(interaction.guildId, verified.user_id);
          continue;
        }
        console.error(`Não foi possível remover o cargo de verificação antigo de ${verified.user_id}:`, error);
        throw new Error("Não consegui substituir o cargo porque não foi possível limpar uma verificação anterior.");
      }
    }
  }

  if (existing?.channel_id === channel.id) {
    try {
      const oldMessage = await channel.messages.fetch(existing.message_id);
      panelMessage = await oldMessage.edit(
        createServerTagPanelPayload(interaction.guildId, requiredTag, role.id, {
          title, description, color, bannerUrl, thumbnailUrl
        })
      );
    } catch (error) {
      if (error.code !== 10003 && error.code !== 10008) throw error;
    }
  }

  if (!panelMessage) {
    panelMessage = await channel.send(
      createServerTagPanelPayload(interaction.guildId, requiredTag, role.id, {
        title, description, color, bannerUrl, thumbnailUrl
      })
    );
  }

  db.prepare(`
    INSERT INTO server_tag_panels (
      guild_id, channel_id, message_id, required_tag, role_id,
      title, description, color, banner_url, thumbnail_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      required_tag = excluded.required_tag,
      role_id = excluded.role_id,
      title = excluded.title,
      description = excluded.description,
      color = excluded.color,
      banner_url = excluded.banner_url,
      thumbnail_url = excluded.thumbnail_url
  `).run(
    interaction.guildId, channel.id, panelMessage.id, requiredTag, role.id,
    title, description, color, bannerUrl, thumbnailUrl
  );

  if (existing && existing.message_id !== panelMessage.id) {
    try {
      const oldChannel = await client.channels.fetch(existing.channel_id);
      if (oldChannel?.isTextBased()) {
        const oldMessage = await oldChannel.messages.fetch(existing.message_id);
        await oldMessage.delete();
      }
    } catch (error) {
      if (error.code !== 10003 && error.code !== 10008) {
        console.error("Não foi possível remover o painel de verificação antigo:", error);
      }
    }
  }

  await interaction.editReply(`Painel de verificação da tag **${requiredTag}** configurado em <#${channel.id}> para conceder <@&${role.id}>.`);
}

async function handleServerTagVerification(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return interaction.reply({ content: "A verificação só pode ser usada dentro do servidor.", ephemeral: true });
  }

  const config = db.prepare(
    "SELECT required_tag, role_id FROM server_tag_panels WHERE guild_id = ?"
  ).get(interaction.guildId);
  if (!config) {
    return interaction.reply({
      content: "O painel ainda não foi configurado por um administrador.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const [role, member, primaryGuild] = await Promise.all([
      getServerTagRole(interaction.guild, config.role_id),
      interaction.guild.members.fetch({ user: interaction.user.id, force: true }),
      fetchUserPrimaryGuild(interaction.user.id)
    ]);

    if (!userHasServerTag(primaryGuild, config.required_tag, interaction.guildId)) {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, `Tag ${config.required_tag} não está ativa.`);
        db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
          .run(interaction.guildId, member.id);
        logServerTagEvent(
          interaction.guild,
          member,
          config.required_tag,
          role.id,
          "Tag inativa",
          "Cargo removido durante a verificação."
        );
        await interaction.editReply(`A tag **${config.required_tag}** não está ativa no seu perfil; removi o cargo <@&${role.id}>.`);
        return;
      }
      logServerTagEvent(
        interaction.guild,
        member,
        config.required_tag,
        role.id,
        "Não verificado",
        "Tag não encontrada ou desativada no perfil."
      );
      await interaction.editReply(
        `Não encontrei a tag **${config.required_tag}** ativa no seu perfil do Discord. Ative-a e tente novamente.`
      );
      return;
    }

    const alreadyHadRole = member.roles.cache.has(role.id);
    if (!alreadyHadRole) {
      db.prepare("INSERT OR IGNORE INTO server_tag_verifications (guild_id, user_id) VALUES (?, ?)")
        .run(interaction.guildId, member.id);
      try {
        await member.roles.add(role, `Verificação da tag ${config.required_tag}`);
      } catch (error) {
        db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
          .run(interaction.guildId, member.id);
        throw error;
      }
    } else {
      db.prepare("INSERT OR IGNORE INTO server_tag_verifications (guild_id, user_id) VALUES (?, ?)")
        .run(interaction.guildId, member.id);
    }

    logServerTagEvent(
      interaction.guild,
      member,
      config.required_tag,
      role.id,
      "Verificado",
      alreadyHadRole ? "Tag confirmada; membro já possuía o cargo." : "Cargo concedido."
    );
    await interaction.editReply(
      alreadyHadRole
        ? `A tag **${config.required_tag}** está ativa e você já possui o cargo <@&${role.id}>.`
        : `Tag **${config.required_tag}** verificada. Você recebeu o cargo <@&${role.id}>.`
    );
  } catch (error) {
    console.error(`Não foi possível verificar a tag de ${interaction.user.id}:`, error);
    await interaction.editReply(
      "Não consegui concluir a verificação. Confira as permissões e a posição do cargo do bot e tente novamente."
    );
  }
}

async function syncServerTagRole(member, config) {
  if (!member.roles.cache.has(config.role_id)) {
    db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
      .run(member.guild.id, member.id);
    return;
  }

  const primaryGuild = await fetchUserPrimaryGuild(member.id);
  if (userHasServerTag(primaryGuild, config.required_tag, member.guild.id)) {
    db.prepare("INSERT OR IGNORE INTO server_tag_verifications (guild_id, user_id) VALUES (?, ?)")
      .run(member.guild.id, member.id);
    return;
  }

  const role = await getServerTagRole(member.guild, config.role_id);
  await member.roles.remove(role, `Tag ${config.required_tag} não está mais ativa.`);
  db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
    .run(member.guild.id, member.id);
  logServerTagEvent(
    member.guild,
    member,
    config.required_tag,
    role.id,
    "Tag inativa",
    "Cargo removido automaticamente."
  );
  console.log(`Cargo de verificação removido de ${member.id}: tag ${config.required_tag} ausente.`);
}

async function auditServerTagVerifications() {
  const verifications = db.prepare(`
    SELECT verification.guild_id, verification.user_id, panel.required_tag, panel.role_id
    FROM server_tag_verifications AS verification
    JOIN server_tag_panels AS panel ON panel.guild_id = verification.guild_id
  `).all();

  for (const verification of verifications) {
    const guild = client.guilds.cache.get(verification.guild_id);
    if (!guild) continue;

    try {
      const member = await guild.members.fetch({ user: verification.user_id, force: true });
      if (!member.roles.cache.has(verification.role_id)) {
        db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
          .run(verification.guild_id, verification.user_id);
        continue;
      }
      await syncServerTagRole(member, verification);
    } catch (error) {
      if (error.code === 10007) {
        db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
          .run(verification.guild_id, verification.user_id);
      } else {
        console.error(`Não foi possível sincronizar o cargo de tag de ${verification.user_id}:`, error);
      }
    }
  }
}

async function handleMuteCommand(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return interaction.reply({ content: "Este comando só pode ser usado no servidor.", ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ content: "Você precisa da permissão Moderar Membros.", ephemeral: true });
  }

  const duration = parseMuteDuration(interaction.options.getString("tempo", true));
  if (!duration) {
    return interaction.reply({
      content: "Informe o tempo como `1h` ou `2d`. O limite do Discord é 28 dias.",
      ephemeral: true
    });
  }

  const userId = parseMemberId(interaction.options.getString("membro", true));
  if (!userId) {
    return interaction.reply({ content: "Informe uma menção ou um ID de membro válido.", ephemeral: true });
  }
  const reason = interaction.options.getString("motivo", true).trim();
  if (!reason) {
    return interaction.reply({ content: "Informe o motivo do mute.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  try {
    const [target, moderator, { role, botMember }] = await Promise.all([
      guild.members.fetch(userId),
      guild.members.fetch(interaction.user.id),
      getMuteRoleAndBotMember(guild)
    ]);
    if (!canModerateMember(target, moderator, botMember, guild)) {
      return interaction.editReply("Não posso aplicar mute nesse membro por causa da hierarquia de cargos.");
    }

    const now = Date.now();
    const expiresAt = now + duration.milliseconds;
    const existingMute = db.prepare(
      "SELECT role_added_by_bot, voice_mute_added_by_bot FROM active_mutes WHERE guild_id = ? AND user_id = ?"
    ).get(guild.id, target.id);
    const hadMuteRole = target.roles.cache.has(role.id);
    const roleAddedByBot = existingMute
      ? Boolean(existingMute.role_added_by_bot)
      : !hadMuteRole;
    const hadServerMute = target.voice.serverMute;
    const previousTimeout = existingMute && existingMute.voice_mute_added_by_bot === null
      ? target.communicationDisabledUntilTimestamp
      : null;
    const shouldTrackServerMute = Boolean(target.voice.channelId &&
      (!hadServerMute || (previousTimeout && previousTimeout > Date.now())));
    const voiceMuteAddedByBot = existingMute
      ? Boolean(existingMute.voice_mute_added_by_bot) ||
        (!existingMute.voice_mute_added_by_bot && shouldTrackServerMute)
      : Boolean(target.voice.channelId && !hadServerMute);
    let voiceMuteApplied = false;
    let legacyTimeoutCleared = false;
    let roleAdded = false;

    try {
      if (!hadServerMute && target.voice.channelId) {
        await target.voice.setMute(true, reason);
        voiceMuteApplied = true;
      }
      if (previousTimeout && previousTimeout > Date.now()) {
        await target.timeout(null, "Convertendo mute temporário legado");
        legacyTimeoutCleared = true;
      }
      if (!hadMuteRole) {
        await target.roles.add(role, reason);
        roleAdded = true;
      }
      db.prepare(`
        INSERT INTO active_mutes (guild_id, user_id, role_id, reason, moderator_id, expires_at, role_added_by_bot, voice_mute_added_by_bot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          role_id = excluded.role_id,
          reason = excluded.reason,
          moderator_id = excluded.moderator_id,
          expires_at = excluded.expires_at,
          role_added_by_bot = excluded.role_added_by_bot,
          voice_mute_added_by_bot = excluded.voice_mute_added_by_bot
      `).run(
        guild.id,
        target.id,
        role.id,
        reason,
        moderator.id,
        expiresAt,
        roleAddedByBot ? 1 : 0,
        voiceMuteAddedByBot ? 1 : 0
      );
    } catch (error) {
      if (roleAdded) {
        await target.roles.remove(role, "Revertendo mute incompleto")
          .catch(rollbackError => console.error("Falha ao reverter o cargo de mute:", rollbackError));
      }
      if (voiceMuteApplied) {
        await target.voice.setMute(false, "Revertendo mute incompleto")
          .catch(rollbackError => console.error("Falha ao reverter o mute de voz:", rollbackError));
      }
      if (legacyTimeoutCleared && previousTimeout > Date.now()) {
        await target.timeout(previousTimeout - Date.now(), "Revertendo conversão de mute")
          .catch(rollbackError => console.error("Falha ao restaurar o timeout legado:", rollbackError));
      }
      throw error;
    }

    const logEmbed = createMuteLogEmbed({
      guild,
      title: "🔇 Membro silenciado sem desconectar da call",
      userId: target.id,
      moderatorId: moderator.id,
      reason,
      duration: duration.label,
      expiresAt
    });
    const warnings = [];
    try {
      await sendServerLog(guild, logEmbed);
    } catch (error) {
      console.error("Mute aplicado, mas não foi possível enviar o registro:", error);
      warnings.push("Não consegui enviar o registro; confira o acesso do bot ao canal de logs.");
    }
    try {
      await target.send({
        embeds: [createMuteDmEmbed({
          guild,
          reason,
          duration: duration.label,
          expiresAt
        })],
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      console.error("Mute aplicado, mas não foi possível enviar o motivo por DM:", error);
      warnings.push("Não consegui enviar o PV da pessoa; ela pode estar com as DMs fechadas.");
    }

    return interaction.editReply(
      `🔇 <@${target.id}> foi silenciado por ${duration.label} e permanece na call. Motivo: ${reason}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`
    );
  } catch (error) {
    console.error("Não foi possível aplicar o mute:", error);
    return interaction.editReply(`Não consegui aplicar o mute: ${error.message}`);
  }
}

async function handleUnmuteCommand(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return interaction.reply({ content: "Este comando só pode ser usado no servidor.", ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ content: "Você precisa da permissão Moderar Membros.", ephemeral: true });
  }

  const userId = parseMemberId(interaction.options.getString("membro", true));
  if (!userId) {
    return interaction.reply({ content: "Informe uma menção ou um ID de membro válido.", ephemeral: true });
  }
  const reason = interaction.options.getString("motivo")?.trim() || "Mute removido manualmente.";

  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  try {
    const [target, moderator, { role, botMember }] = await Promise.all([
      guild.members.fetch(userId),
      guild.members.fetch(interaction.user.id),
      getMuteRoleAndBotMember(guild)
    ]);
    if (!canModerateMember(target, moderator, botMember, guild)) {
      return interaction.editReply("Não posso remover o mute desse membro por causa da hierarquia de cargos.");
    }

    const muteRecord = db.prepare(
      "SELECT expires_at, voice_mute_added_by_bot FROM active_mutes WHERE guild_id = ? AND user_id = ?"
    ).get(guild.id, target.id);
    const hasServerMute = target.voice.serverMute;
    const hadMuteRole = target.roles.cache.has(role.id);
    if (!hasServerMute && !hadMuteRole && !muteRecord) {
      return interaction.editReply("Esse membro não tem um mute ativo.");
    }

    let roleRemoved = false;
    let voiceMuteCleared = false;
    let legacyTimeoutCleared = false;
    const previousTimeout = muteRecord && muteRecord.voice_mute_added_by_bot === null
      ? target.communicationDisabledUntilTimestamp
      : null;
    const hasLegacyTimeout = Boolean(previousTimeout && previousTimeout > Date.now());
    try {
      if (hadMuteRole) {
        await target.roles.remove(role, reason);
        roleRemoved = true;
      }
      const shouldClearServerMute = hasServerMute &&
        (!muteRecord || Boolean(muteRecord.voice_mute_added_by_bot) || hasLegacyTimeout);
      if (shouldClearServerMute) {
        await target.voice.setMute(false, reason);
        voiceMuteCleared = true;
      }
      if (hasLegacyTimeout) {
        await target.timeout(null, reason);
        legacyTimeoutCleared = true;
      }
      db.prepare("DELETE FROM active_mutes WHERE guild_id = ? AND user_id = ?")
        .run(guild.id, target.id);
    } catch (error) {
      if (roleRemoved) {
        await target.roles.add(role, "Revertendo unmute incompleto")
          .catch(rollbackError => console.error("Falha ao restaurar o cargo de mute:", rollbackError));
      }
      if (voiceMuteCleared) {
        await target.voice.setMute(true, "Revertendo unmute incompleto")
          .catch(rollbackError => console.error("Falha ao restaurar o mute de voz:", rollbackError));
      }
      if (legacyTimeoutCleared && previousTimeout > Date.now()) {
        await target.timeout(previousTimeout - Date.now(), "Revertendo unmute incompleto")
          .catch(rollbackError => console.error("Falha ao restaurar o timeout legado:", rollbackError));
      }
      throw error;
    }

    const logEmbed = createMuteLogEmbed({
      guild,
      title: "🔊 Mute removido",
      userId: target.id,
      moderatorId: moderator.id,
      reason,
      duration: muteRecord
        ? `Removido antes do vencimento (<t:${Math.floor(muteRecord.expires_at / 1000)}:R>)`
        : "Removido manualmente"
    });
    try {
      await sendServerLog(guild, logEmbed);
    } catch (error) {
      console.error("Unmute aplicado, mas não foi possível enviar o registro:", error);
      return interaction.editReply("Mute removido, mas não consegui enviar o registro no canal de logs.");
    }
    return interaction.editReply(`🔊 O mute de <@${target.id}> foi removido.`);
  } catch (error) {
    console.error("Não foi possível remover o mute:", error);
    return interaction.editReply(`Não consegui remover o mute: ${error.message}`);
  }
}

async function expireTimedMutes() {
  const expiredMutes = db.prepare(
    "SELECT guild_id, user_id, role_id, reason, moderator_id, expires_at, role_added_by_bot, voice_mute_added_by_bot FROM active_mutes WHERE expires_at <= ?"
  ).all(Date.now());

  for (const expiredMute of expiredMutes) {
    try {
      const currentMute = db.prepare(
        "SELECT guild_id, user_id, role_id, reason, moderator_id, expires_at, role_added_by_bot, voice_mute_added_by_bot FROM active_mutes WHERE guild_id = ? AND user_id = ?"
      ).get(expiredMute.guild_id, expiredMute.user_id);
      if (!currentMute || currentMute.expires_at > Date.now()) continue;

      const guild = await client.guilds.fetch(currentMute.guild_id);
      let member;
      try {
        member = await guild.members.fetch(currentMute.user_id);
      } catch (error) {
        if (error.code === 10007) {
          db.prepare("DELETE FROM active_mutes WHERE guild_id = ? AND user_id = ?")
            .run(currentMute.guild_id, currentMute.user_id);
          continue;
        }
        throw error;
      }

      const legacyTimeout = currentMute.voice_mute_added_by_bot === null &&
        member.communicationDisabledUntilTimestamp > Date.now();
      if ((currentMute.voice_mute_added_by_bot || legacyTimeout) && member.voice.serverMute) {
        await member.voice.setMute(false, "Mute temporário expirado");
      }
      if (legacyTimeout) {
        await member.timeout(null, "Mute temporário expirado");
      }
      if (member.roles.cache.has(currentMute.role_id)) {
        await member.roles.remove(currentMute.role_id, "Mute temporário expirado");
      }
      const deletion = db.prepare(
        "DELETE FROM active_mutes WHERE guild_id = ? AND user_id = ? AND expires_at = ?"
      ).run(currentMute.guild_id, currentMute.user_id, currentMute.expires_at);
      if (!deletion.changes) continue;

      try {
        await sendServerLog(guild, createMuteLogEmbed({
          guild,
          title: "✅ Mute temporário expirado",
          userId: currentMute.user_id,
          moderatorId: currentMute.moderator_id,
          reason: currentMute.reason,
          duration: "Expirado",
          expiresAt: currentMute.expires_at
        }));
      } catch (error) {
        console.error("Mute expirou, mas não foi possível enviar o registro:", error);
      }
    } catch (error) {
      console.error(
        `Não foi possível expirar o mute de ${expiredMute.user_id}:`,
        error
      );
    }
  }
}

function getGuildConfig(guildId) {
  const rows = db.prepare(
    "SELECT setting_key, setting_value FROM guild_settings WHERE guild_id = ?"
  ).all(guildId);
  const settings = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
  const buttonStyle = settings.button_style || "Primary";
  return {
    postChannelId: settings.post_channel_id || process.env.POST_CHANNEL_ID,
    panelTitle: settings.panel_title === undefined ? defaultPanelTitle : settings.panel_title,
    panelDescription: settings.panel_description === undefined ? defaultPanelDescription : settings.panel_description,
    panelColor: settings.panel_color ? Number.parseInt(settings.panel_color, 16) : defaultPanelColor,
    panelBanner: settings.panel_banner || "",
    panelThumbnail: settings.panel_thumbnail || "",
    panelFooter: settings.panel_footer === undefined ? defaultPanelFooter : settings.panel_footer,
    buttonStyle: buttonStyles[buttonStyle] || ButtonStyle.Primary,
    buttonStyleName: buttonStyles[buttonStyle] ? buttonStyle : "Primary"
  };
}

function setGuildSetting(guildId, key, value) {
  db.prepare(`
    INSERT INTO guild_settings (guild_id, setting_key, setting_value)
    VALUES (?, ?, ?)
    ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value
  `).run(guildId, key, value);
}

function fitsDiscordEmbedTextLimit(title, description, footer) {
  return title.length + description.length + footer.length <= 6000;
}

function memberHasConfigRole(member) {
  if (!member) return false;
  const roles = member.roles;
  if (roles?.cache?.has) return roles.cache.has(configRoleId);
  return Array.isArray(roles) && roles.includes(configRoleId);
}

function registerPanelMessage(guildId, channelId, messageId) {
  db.prepare(`
    INSERT OR IGNORE INTO panel_messages (guild_id, channel_id, message_id)
    VALUES (?, ?, ?)
  `).run(guildId, channelId, messageId);
}

async function sendPanel(channel, guildId) {
  const sent = await channel.send(createPanelPayload(guildId));
  registerPanelMessage(guildId, channel.id, sent.id);
  return sent;
}

async function trackPanelsInChannel(channel, guildId) {
  if (!channel?.isTextBased() || !channel.messages) return;
  let messages;
  try {
    messages = await channel.messages.fetch({ limit: 100 });
  } catch (error) {
    console.error("Não foi possível localizar painéis antigos neste canal:", error);
    return;
  }
  for (const message of messages.values()) {
    const hasPublishButton = message.author.id === client.user.id &&
      message.components.some(row =>
        row.components.some(component => component.customId === "open_publish")
      );
    if (hasPublishButton) registerPanelMessage(guildId, channel.id, message.id);
  }
}

function createConfigDashboardPayload(guildId) {
  const config = getGuildConfig(guildId);
  const colorNames = {
    Primary: "Azul",
    Secondary: "Cinza",
    Success: "Verde",
    Danger: "Vermelho"
  };
  return {
    content: [
      "**Configurações do painel**",
      `Título: ${config.panelTitle || "(vazio)"} · Rodapé: ${config.panelFooter || "(vazio)"}`,
      `Botão: ${colorNames[config.buttonStyleName]}`
    ].join("\n"),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("config:content").setLabel("Título, descrição e rodapé").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("config:images").setLabel("Banner e thumbnail").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("config:channel").setLabel("Canal de publicações").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("config:button_style")
          .setPlaceholder("Escolha a cor dos botões")
          .addOptions(
            { label: "Azul", value: "Primary" },
            { label: "Cinza", value: "Secondary" },
            { label: "Verde", value: "Success" },
            { label: "Vermelho", value: "Danger" }
          )
      )
    ]
  };
}

function createSettingsTextInput(customId, label, value, maxLength, style = TextInputStyle.Short) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setRequired(false)
    .setMaxLength(maxLength)
    .setPlaceholder("Deixe vazio para usar o padrão ou limpar este campo.");
  if (value) input.setValue(value.slice(0, maxLength));
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

function createSettingsModal(kind, guildId) {
  const config = getGuildConfig(guildId);
  const modal = new ModalBuilder();
  if (kind === "content") {
    modal.setCustomId("config_modal:content").setTitle("Texto do painel")
      .addLabelComponents(
        createSettingsTextInput("title", "Título", config.panelTitle, 256),
        createSettingsTextInput("description", "Descrição", config.panelDescription, 4000, TextInputStyle.Paragraph),
        createSettingsTextInput("footer", "Rodapé", config.panelFooter, 2048)
      );
  } else if (kind === "images") {
    modal.setCustomId("config_modal:images").setTitle("Imagens do painel")
      .addLabelComponents(
        createSettingsTextInput("banner", "URL do banner", config.panelBanner, 1000),
        createSettingsTextInput("thumbnail", "URL da thumbnail", config.panelThumbnail, 1000)
      );
  } else if (kind === "channel") {
    modal.setCustomId("config_modal:channel").setTitle("Canal de publicações")
      .addLabelComponents(
        createSettingsTextInput("channel", "Canal ou ID (vazio remove)", config.postChannelId || "", 100)
      );
  }
  return modal;
}

function createPanelPayload(guildId) {
  const config = getGuildConfig(guildId);
  const embed = new EmbedBuilder()
    .setColor(config.panelColor)
    .setTitle(config.panelTitle)
    .setDescription(config.panelDescription);
  if (config.panelBanner) embed.setImage(config.panelBanner);
  if (config.panelThumbnail) embed.setThumbnail(config.panelThumbnail);
  if (config.panelFooter) embed.setFooter({ text: config.panelFooter });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_publish")
      .setLabel("Publicar vídeo")
      .setStyle(config.buttonStyle)
  );
  return { embeds: [embed], components: [row] };
}

async function handleEmbedCommand(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "Este comando só pode ser usado em um servidor.", ephemeral: true });
  }
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "Somente administradores podem criar embeds.", ephemeral: true });
  }

  const description = interaction.options.getString("mensagem", true).trim();
  const title = interaction.options.getString("titulo")?.trim() || "";
  const banner = interaction.options.getString("banner")?.trim() || "";
  const thumbnail = interaction.options.getString("thumbnail")?.trim() || "";
  const footer = interaction.options.getString("rodape")?.trim() || "";
  const author = interaction.options.getString("autor")?.trim() || "";
  const color = interaction.options.getString("cor")?.trim() || "";
  const inviteUrl = interaction.options.getString("convite")?.trim() || defaultDiscordInviteUrl;

  if (!description) {
    return interaction.reply({ content: "A mensagem principal não pode ficar vazia.", ephemeral: true });
  }
  if ((banner && !isValidHttpsUrl(banner)) || (thumbnail && !isValidHttpsUrl(thumbnail))) {
    return interaction.reply({ content: "Banner e thumbnail precisam ser URLs HTTPS válidas.", ephemeral: true });
  }
  if (!isValidDiscordInviteUrl(inviteUrl)) {
    return interaction.reply({ content: "O convite precisa ser um link HTTPS válido do Discord.", ephemeral: true });
  }
  if (color && !/^#?[0-9a-f]{6}$/i.test(color)) {
    return interaction.reply({ content: "A cor deve estar no formato `#RRGGBB`, por exemplo `#000000`.", ephemeral: true });
  }
  if (title.length + description.length + footer.length + author.length > 6000) {
    return interaction.reply({ content: "O conteúdo do embed ultrapassa o limite de 6.000 caracteres.", ephemeral: true });
  }

  const embed = new EmbedBuilder().setDescription(description);
  if (title) embed.setTitle(title);
  if (banner) embed.setImage(banner);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (footer) embed.setFooter({ text: footer });
  if (author) embed.setAuthor({ name: author });
  if (color) embed.setColor(Number.parseInt(color.replace(/^#/, ""), 16));

  const discordButton = new ButtonBuilder()
    .setLabel("Discord")
    .setStyle(ButtonStyle.Link)
    .setURL(inviteUrl)
    .setEmoji({ name: "we_cat", id: "1571643615204212798" });
  const channel = interaction.options.getChannel("canal") || interaction.channel;
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    return interaction.reply({ content: "Escolha um canal de texto válido.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(discordButton)],
      allowedMentions: { parse: [] }
    });
    await interaction.editReply(`Embed enviado em <#${channel.id}>.`);
  } catch (error) {
    console.error(`Não foi possível enviar o embed no canal ${channel.id}:`, error);
    await interaction.editReply("Não consegui enviar o embed. Verifique se o bot pode ver o canal, enviar mensagens e incorporar links.");
  }
}

function getLiveVoiceMetrics(guild) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - lastRecentJoinCleanupAt >= 3_600) {
    db.prepare("DELETE FROM guild_member_joins WHERE joined_at < ?").run(nowSeconds - 3_600);
    lastRecentJoinCleanupAt = nowSeconds;
  }

  const metrics = {
    total: 0,
    muted: 0,
    deafened: 0,
    streaming: 0,
    camera: 0,
    recentJoins: db.prepare(`
      SELECT COUNT(*) AS count
      FROM guild_member_joins
      WHERE guild_id = ? AND joined_at >= ?
    `).get(guild.id, nowSeconds - 3_600).count,
    topChannel: null
  };

  const channelCounts = new Map();
  for (const voiceState of guild.voiceStates.cache.values()) {
    if (!voiceState.channelId) continue;

    metrics.total += 1;
    channelCounts.set(
      voiceState.channelId,
      (channelCounts.get(voiceState.channelId) || 0) + 1
    );
    if (voiceState.selfMute || voiceState.serverMute) metrics.muted += 1;
    if (voiceState.selfDeaf || voiceState.serverDeaf) metrics.deafened += 1;
    if (voiceState.streaming) metrics.streaming += 1;
    if (voiceState.selfVideo) metrics.camera += 1;
  }

  for (const [channelId, count] of channelCounts) {
    if (!metrics.topChannel || count > metrics.topChannel.count) {
      metrics.topChannel = { id: channelId, count };
    }
  }

  return metrics;
}

function createLiveStatusEmbed(guild, bannerUrl) {
  const metrics = getLiveVoiceMetrics(guild);
  const previousCount = previousVoiceCounts.get(guild.id);
  previousVoiceCounts.set(guild.id, metrics.total);

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`<:Usurio:1571330785422606396> Temos ${metrics.total} participantes em call!`)
    .setDescription("Atividade atualizada automaticamente a cada 5 segundos.")
    .addFields(
      {
        name: "<:7567:1571332054128402462> TOP Call",
        value: metrics.topChannel
          ? `<#${metrics.topChannel.id}> — ${metrics.topChannel.count} membros`
          : "Nenhum membro em call no momento.",
        inline: false
      },
      {
        name: "<a:012Blue_Stars2:1571656389346992270> Atividade de voz",
        value: `**Membros em call:** ${previousCount === undefined ? metrics.total : `${previousCount} → ${metrics.total}`}\n` +
          `**Mutados:** ${metrics.muted} • **Surdos:** ${metrics.deafened} • **Sem mute:** ${metrics.total - metrics.muted}`,
        inline: false
      },
      {
        name: "<a:1327037490477010984:1571330274531213402> Câmera e transmissão",
        value: `**Transmitindo tela:** ${metrics.streaming} • **Câmera ligada:** ${metrics.camera}`,
        inline: true
      },
      {
        name: "<:we_cat:1571643615204212798> Servidor",
        value: `${guild.memberCount} membros`,
        inline: true
      },
      {
        name: "<a:012Blue_Stars2:1571656389346992270> Novos membros",
        value: `${metrics.recentJoins} na última hora`,
        inline: true
      }
    )
    .setFooter({ text: `Atualizado <t:${Math.floor(Date.now() / 1000)}:R>` });

  if (bannerUrl) embed.setImage(bannerUrl);
  return embed;
}

async function handleLiveStatusCommand(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "Este comando só pode ser usado em um servidor.", ephemeral: true });
  }
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "Somente administradores podem configurar o status.", ephemeral: true });
  }

  const channel = interaction.options.getChannel("canal") || interaction.channel;
  const requestedBanner = interaction.options.getString("banner")?.trim() || "";
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    return interaction.reply({ content: "Escolha um canal de texto válido.", ephemeral: true });
  }
  if (requestedBanner && !isValidHttpsUrl(requestedBanner)) {
    return interaction.reply({ content: "O banner precisa ser uma URL HTTPS válida.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const guildId = interaction.guildId;
    const existing = db.prepare(
      "SELECT channel_id, message_id, banner_url FROM live_status_messages WHERE guild_id = ?"
    ).get(guildId);
    const bannerUrl = requestedBanner || existing?.banner_url || "";
    let message = null;

    if (existing?.channel_id === channel.id) {
      try {
        message = liveStatusMessageCache.get(guildId) ||
          await channel.messages.fetch(existing.message_id);
      } catch (error) {
        if (error.code !== 10008) throw error;
        liveStatusMessageCache.delete(guildId);
      }
    }

    const payload = {
      embeds: [createLiveStatusEmbed(interaction.guild, bannerUrl)],
      allowedMentions: { parse: [] }
    };
    if (message) {
      await message.edit(payload);
    } else {
      message = await channel.send(payload);
    }

    db.prepare(`
      INSERT INTO live_status_messages (guild_id, channel_id, message_id, banner_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = excluded.message_id,
        banner_url = excluded.banner_url
    `).run(guildId, channel.id, message.id, bannerUrl);
    liveStatusMessageCache.set(guildId, message);

    let previousMessageWarning = "";
    if (existing && existing.channel_id !== channel.id) {
      try {
        const oldChannel = await client.channels.fetch(existing.channel_id);
        if (oldChannel?.isTextBased()) {
          const oldMessage = await oldChannel.messages.fetch(existing.message_id);
          await oldMessage.delete();
        }
      } catch (error) {
        if (error.code !== 10003 && error.code !== 10008) {
          console.error(`Não foi possível remover o status antigo ${existing.message_id}:`, error);
          previousMessageWarning = " Não consegui apagar a mensagem antiga; ela pode ser removida manualmente.";
        }
      }
    }

    await interaction.editReply(`Status ativo em <#${channel.id}> e atualizado a cada 5 segundos.${previousMessageWarning}`);
  } catch (error) {
    console.error(`Não foi possível configurar o status no servidor ${interaction.guildId}:`, error);
    await interaction.editReply("Não consegui criar ou atualizar o status. Verifique se o bot pode ver o canal, enviar mensagens e incorporar links.");
  }
}

async function refreshLiveStatusMessages() {
  const statuses = db.prepare(
    "SELECT guild_id, channel_id, message_id, banner_url FROM live_status_messages"
  ).all();

  for (const status of statuses) {
    const guild = client.guilds.cache.get(status.guild_id);
    if (!guild) continue;

    try {
      let message = liveStatusMessageCache.get(status.guild_id);
      if (!message) {
        const channel = await client.channels.fetch(status.channel_id);
        if (!channel?.isTextBased() || typeof channel.messages?.fetch !== "function") {
          throw new Error(`Canal de status indisponível: ${status.channel_id}`);
        }
        message = await channel.messages.fetch(status.message_id);
        liveStatusMessageCache.set(status.guild_id, message);
      }

      await message.edit({
        embeds: [createLiveStatusEmbed(guild, status.banner_url)],
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      if (error.code === 10003 || error.code === 10008) {
        console.warn(`Mensagem de status não encontrada; removendo a configuração do servidor ${status.guild_id}.`);
        liveStatusMessageCache.delete(status.guild_id);
        db.prepare("DELETE FROM live_status_messages WHERE guild_id = ?").run(status.guild_id);
      } else {
        console.error(`Não foi possível atualizar o status do servidor ${status.guild_id}:`, error);
      }
    }
  }
}

function createTinderPanelPayload(guildId) {
  const settings = db.prepare(
    "SELECT title, description, color FROM tinder_panel_settings WHERE guild_id = ?"
  ).get(guildId);
  const embed = new EmbedBuilder()
    .setColor(settings?.color ?? 0xeb459e)
    .setTitle(settings?.title || "Tinder do servidor")
    .setDescription(settings?.description ||
      `Crie ou atualize seu perfil para aparecer em <#${tinderProfileChannelId}>. ` +
      "Ao continuar, você confirma que tem 18 anos ou mais e autoriza a publicação das informações e da mídia do perfil.")
    .addFields({
      name: "Como funciona",
      value: "Veja os perfis, escolha **Metch** e aguarde a resposta por DM. Matches aceitos ganham um canal privado no servidor."
    })
    .setFooter({ text: "Somente maiores de 18 anos. Não publique informações que não queira compartilhar." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("tinder:create")
      .setLabel("Criar / atualizar perfil")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("tinder:delete")
      .setLabel("Remover meu perfil")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("tinder:matches")
      .setLabel("Meus matches")
      .setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function handleTinderPanelCommand(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "Este comando só pode ser usado em um servidor.", ephemeral: true });
  }
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "Somente administradores podem configurar o painel.", ephemeral: true });
  }

  const titleInput = interaction.options.getString("titulo");
  const descriptionInput = interaction.options.getString("descricao");
  const colorInput = interaction.options.getString("cor");
  if (titleInput !== null && !titleInput.trim()) {
    return interaction.reply({ content: "O título do painel não pode ficar vazio.", ephemeral: true });
  }
  if (descriptionInput !== null && !descriptionInput.trim()) {
    return interaction.reply({ content: "A descrição do painel não pode ficar vazia.", ephemeral: true });
  }
  if (colorInput !== null && !/^#?[0-9a-f]{6}$/i.test(colorInput.trim())) {
    return interaction.reply({ content: "A cor precisa estar no formato hexadecimal, por exemplo #EB459E.", ephemeral: true });
  }

  const channel = interaction.options.getChannel("canal") || interaction.channel;
  if (!channel?.isTextBased() || typeof channel.send !== "function" ||
      channel.guildId !== interaction.guildId) {
    return interaction.reply({ content: "Escolha um canal de texto válido deste servidor.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    if (titleInput !== null || descriptionInput !== null || colorInput !== null) {
      const currentSettings = db.prepare(
        "SELECT title, description, color FROM tinder_panel_settings WHERE guild_id = ?"
      ).get(interaction.guildId);
      db.prepare(`
        INSERT INTO tinder_panel_settings (guild_id, title, description, color)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          color = excluded.color
      `).run(
        interaction.guildId,
        titleInput === null
          ? currentSettings?.title || "Tinder do servidor"
          : sanitizeTinderText(titleInput.trim()),
        descriptionInput === null
          ? currentSettings?.description ||
            `Crie ou atualize seu perfil para aparecer em <#${tinderProfileChannelId}>. ` +
            "Ao continuar, você confirma que tem 18 anos ou mais e autoriza a publicação das informações e da mídia do perfil."
          : sanitizeTinderText(descriptionInput.trim()),
        colorInput === null
          ? currentSettings?.color ?? 0xeb459e
          : Number.parseInt(colorInput.trim().replace(/^#/, ""), 16)
      );
    }

    const profileChannel = await client.channels.fetch(tinderProfileChannelId);
    if (!profileChannel?.isTextBased() || profileChannel.guildId !== interaction.guildId) {
      throw new Error(`O canal de perfis ${tinderProfileChannelId} não está acessível neste servidor.`);
    }

    const existing = db.prepare(
      "SELECT channel_id, message_id FROM tinder_panel_messages WHERE guild_id = ?"
    ).get(interaction.guildId);
    let message = null;
    if (existing?.channel_id === channel.id) {
      try {
        message = await channel.messages.fetch(existing.message_id);
      } catch (error) {
        if (error.code !== 10008) throw error;
      }
    }

    if (message) {
      await message.edit(createTinderPanelPayload(interaction.guildId));
    } else {
      message = await channel.send(createTinderPanelPayload(interaction.guildId));
    }

    db.prepare(`
      INSERT INTO tinder_panel_messages (guild_id, channel_id, message_id)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = excluded.message_id
    `).run(interaction.guildId, channel.id, message.id);

    let previousPanelWarning = "";
    if (existing && existing.channel_id !== channel.id) {
      try {
        const oldChannel = await client.channels.fetch(existing.channel_id);
        if (oldChannel?.isTextBased()) {
          const oldMessage = await oldChannel.messages.fetch(existing.message_id);
          await oldMessage.delete();
        }
      } catch (error) {
        if (error.code !== 10003 && error.code !== 10008) {
          console.error(`Não foi possível remover o painel Tinder antigo ${existing.message_id}:`, error);
          previousPanelWarning = " Não consegui apagar o painel antigo; ele pode ser removido manualmente.";
        }
      }
    }

    await interaction.editReply(`Painel do Tinder ativo em <#${channel.id}>.${previousPanelWarning}`);
  } catch (error) {
    console.error(`Não foi possível configurar o painel Tinder no servidor ${interaction.guildId}:`, error);
    await interaction.editReply(
      `Não consegui criar o painel. Verifique o canal de perfis <#${tinderProfileChannelId}> e as permissões do bot.`
    );
  }
}

function createTinderProfileModal() {
  const bio = new TextInputBuilder()
    .setCustomId("bio")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(400)
    .setPlaceholder("Conte um pouco sobre você");
  const gender = new TextInputBuilder()
    .setCustomId("gender")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(40)
    .setPlaceholder(tinderGenders.join(", "));
  const age = new TextInputBuilder()
    .setCustomId("age")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(2)
    .setPlaceholder("18 ou mais");
  const city = new TextInputBuilder()
    .setCustomId("city")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80)
    .setPlaceholder("Sua cidade");
  const media = new FileUploadBuilder()
    .setCustomId("media")
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1)
    .setFileTypes(".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".mov", ".webm", ".m4v");

  return new ModalBuilder()
    .setCustomId("tinder:profile")
    .setTitle("Criar seu perfil")
    .addLabelComponents(
      new LabelBuilder().setLabel("Bio (opcional)").setTextInputComponent(bio),
      new LabelBuilder()
        .setLabel("Gênero")
        .setDescription(`Opções: ${tinderGenders.join(", ")}`)
        .setTextInputComponent(gender),
      new LabelBuilder().setLabel("Idade").setTextInputComponent(age),
      new LabelBuilder().setLabel("Cidade").setTextInputComponent(city),
      new LabelBuilder()
        .setLabel("Foto ou vídeo")
        .setDescription("Anexe uma imagem ou vídeo de até 25 MB.")
        .setFileUploadComponent(media)
    );
}

function isValidTinderMediaAttachment(attachment) {
  if (!attachment || attachment.size > maxTinderMediaSize) return false;
  const extension = attachment.name?.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || "";
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
  const videoExtensions = [".mp4", ".mov", ".webm", ".m4v"];
  const imageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const videoTypes = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/m4v"];
  const contentType = attachment.contentType?.toLowerCase() || "";
  if (contentType && contentType !== "application/octet-stream" &&
      !imageTypes.includes(contentType) && !videoTypes.includes(contentType)) {
    return false;
  }
  const isImage = imageExtensions.includes(extension) || imageTypes.includes(contentType);
  const isVideo = videoExtensions.includes(extension) || videoTypes.includes(contentType);
  if (!isImage && !isVideo) return false;
  if (contentType.startsWith("image/") && !imageTypes.includes(contentType)) return false;
  if (contentType.startsWith("video/") && !videoTypes.includes(contentType)) return false;
  if (imageExtensions.includes(extension) && isVideo) return false;
  if (videoExtensions.includes(extension) && isImage) return false;
  return true;
}

function sanitizeTinderText(value) {
  return value.replace(/@everyone|@here/gi, match => `@\u200b${match.slice(1)}`);
}

function getTinderMediaFileName(userId, attachment) {
  const extension = attachment.name?.match(/\.(png|jpe?g|gif|webp|mp4|mov|webm|m4v)$/i)?.[0]?.toLowerCase();
  const contentType = attachment.contentType?.toLowerCase() || "";
  const fallbackExtension = contentType.startsWith("image/") ? ".jpg" : ".mp4";
  return `tinder-${userId}-${Date.now()}${extension || fallbackExtension}`;
}

function getTinderMediaType(attachment) {
  const contentType = attachment.contentType?.toLowerCase() || "";
  if (contentType.startsWith("image/") || contentType.startsWith("video/")) return contentType;
  const extension = attachment.name?.match(/\.(png|jpe?g|gif|webp|mp4|mov|webm|m4v)$/i)?.[0]?.toLowerCase();
  const mediaTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v"
  };
  return mediaTypes[extension] || "application/octet-stream";
}

function createTinderProfileComponents(profile, displayName, userId) {
  const safeDisplayName = sanitizeTinderText(displayName.replace(/[\r\n]/g, " "));
  const card = new ContainerBuilder()
    .setAccentColor(0xeb459e)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${safeDisplayName} • ${profile.age} anos**\n\n` +
        `${profile.bio || "Sem bio."}\n\n` +
        `**Gênero:** ${profile.gender} • **Cidade:** ${profile.city}\n\n` +
        "*Perfil 18+ • Use os botões para Metch ou passar.*"
      )
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${profile.media_name}`)
      )
    )
    .addActionRowComponents(createTinderProfileButtons(userId));

  return [card];
}

function createTinderProfileButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tinder:like:${userId}`)
      .setLabel("Metch")
      .setEmoji({ name: "1327037490477010984", id: "1571330274531213402", animated: true })
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`tinder:pass:${userId}`)
      .setLabel("Passar")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function refreshTinderProfiles() {
  const profiles = db.prepare(
    "SELECT * FROM tinder_profiles WHERE active = 1"
  ).all();

  for (const profile of profiles) {
    try {
      const channel = await client.channels.fetch(profile.profile_channel_id);
      if (!channel?.isTextBased()) throw new Error("Canal do perfil indisponível.");
      const message = await channel.messages.fetch(profile.profile_message_id);
      if (message.flags.has(MessageFlags.IsComponentsV2)) continue;

      const media = message.attachments.find(attachment => attachment.name === profile.media_name) ||
        message.attachments.first();
      if (!media) throw new Error("Mídia do perfil não encontrada na mensagem.");

      const oldAuthor = message.embeds[0]?.author;
      const displayName = oldAuthor?.name || profile.user_id;
      await message.edit({
        flags: MessageFlags.IsComponentsV2,
        content: null,
        embeds: [],
        components: createTinderProfileComponents(
          { ...profile, media_name: media.name },
          displayName,
          profile.user_id
        ),
        attachments: [...message.attachments.values()],
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      console.error(`Não foi possível atualizar o perfil Tinder ${profile.user_id}:`, error.message);
    }
  }
}

async function handleTinderProfileSubmit(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "O perfil só pode ser criado dentro do servidor.", ephemeral: true });
  }

  const bio = sanitizeTinderText(interaction.fields.getTextInputValue("bio").trim());
  const genderInput = interaction.fields.getTextInputValue("gender").trim();
  const gender = tinderGenders.find(value => value.toLocaleLowerCase("pt-BR") === genderInput.toLocaleLowerCase("pt-BR"));
  const ageInput = interaction.fields.getTextInputValue("age").trim();
  const age = Number(ageInput);
  const city = sanitizeTinderText(interaction.fields.getTextInputValue("city").trim());
  const attachment = interaction.fields.getUploadedFiles("media")?.first();

  if (!gender) {
    return interaction.reply({
      content: `Escolha um gênero da lista: ${tinderGenders.join(", ")}.`,
      ephemeral: true
    });
  }
  if (!/^\d{2}$/.test(ageInput) || !Number.isInteger(age) || age < 18 || age > 99) {
    return interaction.reply({ content: "O Tinder do servidor é somente para maiores de 18 anos.", ephemeral: true });
  }
  if (!city || city.length > 80) {
    return interaction.reply({ content: "Informe uma cidade válida, com até 80 caracteres.", ephemeral: true });
  }
  if (bio.length > 400) {
    return interaction.reply({ content: "A bio pode ter no máximo 400 caracteres.", ephemeral: true });
  }
  if (!isValidTinderMediaAttachment(attachment)) {
    return interaction.reply({
      content: "Anexe uma foto PNG, JPG, GIF ou WEBP, ou vídeo MP4, MOV, WEBM ou M4V, de até 25 MB.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });
  let sentMessage;
  try {
    const profileChannel = await client.channels.fetch(tinderProfileChannelId);
    if (!profileChannel?.isTextBased() || profileChannel.guildId !== interaction.guildId ||
        typeof profileChannel.send !== "function") {
      throw new Error(`Canal de perfis indisponível: ${tinderProfileChannelId}`);
    }

    const mediaResponse = await fetch(attachment.url);
    if (!mediaResponse.ok) throw new Error(`Download de mídia falhou com HTTP ${mediaResponse.status}.`);
    const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
    if (mediaBuffer.length > maxTinderMediaSize) {
      await interaction.editReply("O arquivo excede o limite de 25 MB.");
      return;
    }

    const mediaName = getTinderMediaFileName(interaction.user.id, attachment);
    const profile = {
      bio,
      gender,
      age,
      city,
      media_name: mediaName,
      media_type: getTinderMediaType(attachment)
    };
    const displayName = interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username;
    const oldProfile = db.prepare(
      "SELECT profile_channel_id, profile_message_id FROM tinder_profiles WHERE guild_id = ? AND user_id = ?"
    ).get(interaction.guildId, interaction.user.id);

    sentMessage = await profileChannel.send({
      flags: MessageFlags.IsComponentsV2,
      components: createTinderProfileComponents(profile, displayName, interaction.user.id),
      files: [new AttachmentBuilder(mediaBuffer, { name: mediaName })],
      allowedMentions: { parse: [] }
    });

    try {
      db.prepare(`
        INSERT INTO tinder_profiles (
          guild_id, user_id, profile_channel_id, profile_message_id,
          bio, gender, age, city, media_name, media_type, active, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          profile_channel_id = excluded.profile_channel_id,
          profile_message_id = excluded.profile_message_id,
          bio = excluded.bio,
          gender = excluded.gender,
          age = excluded.age,
          city = excluded.city,
          media_name = excluded.media_name,
          media_type = excluded.media_type,
          active = 1,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        interaction.guildId,
        interaction.user.id,
        profileChannel.id,
        sentMessage.id,
        bio,
        gender,
        age,
        city,
        mediaName,
        profile.media_type
      );
    } catch (error) {
      await sentMessage.delete().catch(deleteError => {
        console.error("Não foi possível remover um perfil Tinder publicado sem registro:", deleteError);
      });
      throw error;
    }

    let oldProfileWarning = "";
    if (oldProfile) {
      try {
        const oldChannel = await client.channels.fetch(oldProfile.profile_channel_id);
        if (oldChannel?.isTextBased()) {
          const oldMessage = await oldChannel.messages.fetch(oldProfile.profile_message_id);
          await oldMessage.delete();
        }
      } catch (error) {
        if (error.code !== 10003 && error.code !== 10008) {
          console.error(`Não foi possível remover o perfil Tinder antigo de ${interaction.user.id}:`, error);
          oldProfileWarning = " Não consegui apagar a publicação antiga; um administrador pode removê-la manualmente.";
        }
      }
    }
    await interaction.editReply(`Seu perfil foi publicado em <#${tinderProfileChannelId}>.${oldProfileWarning}`);
  } catch (error) {
    console.error(`Não foi possível publicar o perfil Tinder de ${interaction.user.id}:`, error);
    await interaction.editReply(
      "Não consegui publicar seu perfil. Verifique se o bot tem acesso ao canal de perfis e tente novamente."
    );
  }
}

async function removeTinderProfile(interaction) {
  const profile = db.prepare(
    "SELECT profile_channel_id, profile_message_id FROM tinder_profiles WHERE guild_id = ? AND user_id = ? AND active = 1"
  ).get(interaction.guildId, interaction.user.id);
  if (!profile) {
    return interaction.update({ content: "Você não tem um perfil ativo para remover.", embeds: [], components: [] });
  }

  await interaction.deferUpdate();
  try {
    const channel = await client.channels.fetch(profile.profile_channel_id);
    if (channel?.isTextBased()) {
      const message = await channel.messages.fetch(profile.profile_message_id);
      await message.delete();
    }
  } catch (error) {
    if (error.code !== 10003 && error.code !== 10008) {
      console.error(`Não foi possível remover a publicação Tinder de ${interaction.user.id}:`, error);
      await interaction.editReply({
        content: "Não consegui apagar a publicação do canal. Seu perfil continua ativo; confira as permissões e tente novamente.",
        embeds: [],
        components: []
      });
      return;
    }
  }
  db.prepare(
    "DELETE FROM tinder_profiles WHERE guild_id = ? AND user_id = ?"
  ).run(interaction.guildId, interaction.user.id);
  db.prepare(`
    UPDATE tinder_match_requests SET status = 'cancelled'
    WHERE guild_id = ? AND status IN ('pending', 'creating') AND (sender_id = ? OR recipient_id = ?)
  `).run(interaction.guildId, interaction.user.id, interaction.user.id);
  db.prepare(
    "DELETE FROM tinder_swipes WHERE guild_id = ? AND swiper_id = ?"
  ).run(interaction.guildId, interaction.user.id);
  await interaction.editReply({ content: "Seu perfil foi removido.", embeds: [], components: [] });
}

async function handleTinderLike(interaction, targetId) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "Matches só podem ser iniciados dentro do servidor.", ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    if (targetId === interaction.user.id) {
      return interaction.editReply("Você não pode dar match com seu próprio perfil.");
    }
    const requesterProfile = db.prepare(
      "SELECT active FROM tinder_profiles WHERE guild_id = ? AND user_id = ?"
    ).get(interaction.guildId, interaction.user.id);
    if (!requesterProfile?.active) {
      return interaction.editReply("Crie seu perfil pelo painel antes de dar match.");
    }

    const targetProfile = db.prepare(
      "SELECT * FROM tinder_profiles WHERE guild_id = ? AND user_id = ? AND active = 1"
    ).get(interaction.guildId, targetId);
    if (!targetProfile || interaction.message.id !== targetProfile.profile_message_id) {
      return interaction.editReply("Este perfil não está mais ativo.");
    }

    const previousSwipe = db.prepare(
      "SELECT action FROM tinder_swipes WHERE guild_id = ? AND swiper_id = ? AND target_id = ?"
    ).get(interaction.guildId, interaction.user.id, targetId);
    if (previousSwipe?.action === "pass") {
      return interaction.editReply("Você já passou este perfil.");
    }

    let request = db.prepare(`
      SELECT id, status FROM tinder_match_requests
      WHERE guild_id = ? AND sender_id = ? AND recipient_id = ?
    `).get(interaction.guildId, interaction.user.id, targetId);
    if (request && !["undeliverable", "cancelled"].includes(request.status)) {
      const messages = {
        pending: "Sua solicitação de match já foi enviada.",
        creating: "A solicitação está sendo processada.",
        accepted: "Vocês já deram match!",
        declined: "Esta solicitação já foi recusada.",
        cancelled: "Esta solicitação não está mais ativa."
      };
      return interaction.editReply(messages[request.status] || "Você já enviou uma solicitação para este perfil.");
    }

    db.prepare(`
      INSERT INTO tinder_swipes (guild_id, swiper_id, target_id, action)
      VALUES (?, ?, ?, 'like')
      ON CONFLICT(guild_id, swiper_id, target_id) DO UPDATE SET action = 'like'
    `).run(interaction.guildId, interaction.user.id, targetId);

    if (request && ["undeliverable", "cancelled"].includes(request.status)) {
      db.prepare(`
        UPDATE tinder_match_requests SET status = 'pending',
        request_channel_id = NULL, request_message_id = NULL, private_channel_id = NULL
        WHERE id = ?
      `).run(request.id);
    } else {
      const result = db.prepare(`
        INSERT INTO tinder_match_requests (guild_id, sender_id, recipient_id)
        VALUES (?, ?, ?)
      `).run(interaction.guildId, interaction.user.id, targetId);
      request = { id: Number(result.lastInsertRowid), status: "pending" };
    }

    try {
      const targetUser = await client.users.fetch(targetId);
      const requesterProfileCard = db.prepare(
        "SELECT profile_channel_id, profile_message_id FROM tinder_profiles WHERE guild_id = ? AND user_id = ? AND active = 1"
      ).get(interaction.guildId, interaction.user.id);
      const profileUrl = requesterProfileCard
        ? `https://discord.com/channels/${interaction.guildId}/${requesterProfileCard.profile_channel_id}/${requesterProfileCard.profile_message_id}`
        : null;
      const requesterName = interaction.member?.displayName ||
        interaction.user.globalName ||
        interaction.user.username;
      const requestMessage = await targetUser.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xeb459e)
            .setTitle("Você recebeu uma solicitação de match!")
            .setDescription(`**${sanitizeTinderText(requesterName)}** quer dar match com você.`)
            .addFields(profileUrl
              ? { name: "Ver perfil", value: `[Abrir perfil](${profileUrl})` }
              : { name: "Servidor", value: `Solicitação enviada em **${interaction.guild.name}**.` })
            .setThumbnail(interaction.user.displayAvatarURL())
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`tinder:accept:${request.id}`)
              .setLabel("Aceitar")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`tinder:decline:${request.id}`)
              .setLabel("Recusar")
              .setStyle(ButtonStyle.Danger)
          )
        ],
        allowedMentions: { parse: [] }
      });
      db.prepare(`
        UPDATE tinder_match_requests
        SET request_channel_id = ?, request_message_id = ?
        WHERE id = ?
      `).run(requestMessage.channelId, requestMessage.id, request.id);
      await interaction.editReply(`Solicitação enviada para **${sanitizeTinderText(targetUser.username)}** por DM.`);
    } catch (error) {
      db.prepare("UPDATE tinder_match_requests SET status = 'undeliverable' WHERE id = ?").run(request.id);
      console.error(`Não foi possível enviar solicitação Tinder para ${targetId}:`, error);
      await interaction.editReply("Não consegui enviar a solicitação por DM. A pessoa precisa permitir mensagens privadas para tentar novamente.");
    }
  } catch (error) {
    console.error(`Erro ao processar match Tinder para ${interaction.user.id}:`, error);
    await interaction.editReply("Não consegui processar o match. Tente novamente mais tarde.");
  }
}

async function handleTinderPass(interaction, targetId) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "Esta ação só pode ser usada no servidor.", ephemeral: true });
  }
  if (targetId === interaction.user.id) {
    return interaction.reply({ content: "Você não pode passar seu próprio perfil.", ephemeral: true });
  }
  const activeProfile = db.prepare(
    "SELECT active FROM tinder_profiles WHERE guild_id = ? AND user_id = ?"
  ).get(interaction.guildId, interaction.user.id);
  if (!activeProfile?.active) {
    return interaction.reply({ content: "Crie seu perfil pelo painel antes de usar os perfis.", ephemeral: true });
  }
  const targetProfile = db.prepare(
    "SELECT profile_message_id FROM tinder_profiles WHERE guild_id = ? AND user_id = ? AND active = 1"
  ).get(interaction.guildId, targetId);
  if (!targetProfile || interaction.message.id !== targetProfile.profile_message_id) {
    return interaction.reply({ content: "Este perfil não está mais ativo.", ephemeral: true });
  }
  const existingRequest = db.prepare(`
    SELECT status FROM tinder_match_requests
    WHERE guild_id = ? AND sender_id = ? AND recipient_id = ?
  `).get(interaction.guildId, interaction.user.id, targetId);
  if (existingRequest) {
    return interaction.reply({ content: "Você já enviou uma solicitação para este perfil.", ephemeral: true });
  }
  db.prepare(`
    INSERT OR IGNORE INTO tinder_swipes (guild_id, swiper_id, target_id, action)
    VALUES (?, ?, ?, 'pass')
  `).run(interaction.guildId, interaction.user.id, targetId);
  return interaction.reply({ content: "Perfil passado.", ephemeral: true });
}

async function showTinderMatches(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "Esta ação só pode ser usada no servidor.", ephemeral: true });
  }
  const matches = db.prepare(`
    SELECT id, sender_id, recipient_id, private_channel_id, created_at
    FROM tinder_match_requests
    WHERE guild_id = ? AND status = 'accepted' AND private_channel_id IS NOT NULL
      AND (sender_id = ? OR recipient_id = ?)
    ORDER BY id DESC LIMIT 20
  `).all(interaction.guildId, interaction.user.id, interaction.user.id);
  const seenChannels = new Set();
  const lines = [];
  for (const match of matches) {
    if (seenChannels.has(match.private_channel_id)) continue;
    seenChannels.add(match.private_channel_id);
    const partnerId = match.sender_id === interaction.user.id ? match.recipient_id : match.sender_id;
    lines.push(`<@${partnerId}> — <#${match.private_channel_id}>`);
  }
  return interaction.reply({
    content: lines.length
      ? `Seus matches recentes:\n${lines.join("\n")}`
      : "Você ainda não tem matches aceitos.",
    ephemeral: true,
    allowedMentions: { parse: [] }
  });
}

async function handleTinderRequestResponse(interaction, requestId, accept) {
  if (!Number.isSafeInteger(requestId) || requestId < 1) {
    return interaction.reply({ content: "Esta solicitação não é válida.", ephemeral: true });
  }
  const request = db.prepare(
    "SELECT * FROM tinder_match_requests WHERE id = ?"
  ).get(requestId);
  if (!request || request.recipient_id !== interaction.user.id) {
    return interaction.reply({ content: "Esta solicitação não é sua ou não está mais disponível.", ephemeral: true });
  }
  if (request.status === "accepted" && request.private_channel_id) {
    return interaction.update({
      content: `Vocês já deram match! A conversa está em <#${request.private_channel_id}>.`,
      embeds: [],
      components: []
    });
  }
  if (request.status !== "pending") {
    return interaction.update({
      content: "Esta solicitação não está mais pendente.",
      embeds: [],
      components: []
    });
  }

  if (accept) {
    const reciprocalRequest = db.prepare(`
      SELECT id, status, private_channel_id
      FROM tinder_match_requests
      WHERE guild_id = ? AND id != ?
        AND sender_id = ? AND recipient_id = ?
      LIMIT 1
    `).get(request.guild_id, requestId, request.recipient_id, request.sender_id);
    if (reciprocalRequest?.status === "accepted" && reciprocalRequest.private_channel_id) {
      db.prepare(`
        UPDATE tinder_match_requests SET status = 'accepted', private_channel_id = ?
        WHERE id = ? AND status = 'pending'
      `).run(reciprocalRequest.private_channel_id, requestId);
      return interaction.update({
        content: `Vocês já deram match! A conversa está em <#${reciprocalRequest.private_channel_id}>.`,
        embeds: [],
        components: []
      });
    }
    if (reciprocalRequest?.status === "creating") {
      return interaction.update({
        content: "Esta conversa já está sendo criada. Confira seus matches em alguns instantes.",
        embeds: [],
        components: []
      });
    }
  }

  if (!accept) {
    const result = db.prepare(`
      UPDATE tinder_match_requests SET status = 'declined'
      WHERE id = ? AND recipient_id = ? AND status = 'pending'
    `).run(requestId, interaction.user.id);
    if (!result.changes) {
      return interaction.update({ content: "Esta solicitação já foi respondida.", embeds: [], components: [] });
    }
    return interaction.update({ content: "Solicitação recusada.", embeds: [], components: [] });
  }

  const result = db.prepare(`
    UPDATE tinder_match_requests SET status = 'creating'
    WHERE id = ? AND recipient_id = ? AND status = 'pending'
  `).run(requestId, interaction.user.id);
  if (!result.changes) {
    return interaction.update({ content: "Esta solicitação já está sendo processada.", embeds: [], components: [] });
  }
  await interaction.deferUpdate();

  let privateChannel;
  try {
    const guild = await client.guilds.fetch(request.guild_id);
    await Promise.all([
      guild.members.fetch(request.sender_id),
      guild.members.fetch(request.recipient_id)
    ]);
    privateChannel = await guild.channels.create({
      name: `match-${requestId}`,
      type: ChannelType.GuildText,
      topic: "Conversa privada entre os participantes de um match.",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]
        },
        {
          id: request.sender_id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]
        },
        {
          id: request.recipient_id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]
        }
      ],
      reason: `Match Tinder aceito (solicitação ${requestId})`
    });
  } catch (error) {
    if (error.code === 10007) {
      db.prepare("UPDATE tinder_match_requests SET status = 'cancelled' WHERE id = ? AND status = 'creating'").run(requestId);
      await interaction.editReply({
        content: "Um dos participantes não está mais no servidor; a solicitação foi cancelada.",
        embeds: [],
        components: []
      });
      return;
    }
    db.prepare("UPDATE tinder_match_requests SET status = 'pending' WHERE id = ? AND status = 'creating'").run(requestId);
    console.error(`Não foi possível criar o canal privado do match ${requestId}:`, error);
    await interaction.editReply({
      content: "Não consegui criar o canal privado. Verifique se o bot tem a permissão **Gerenciar Canais** e tente aceitar novamente.",
      components: interaction.message.components
    });
    return;
  }

  const acceptedRequest = db.prepare(`
    UPDATE tinder_match_requests
    SET status = 'accepted', private_channel_id = ?
    WHERE id = ? AND status = 'creating'
  `).run(privateChannel.id, requestId);
  if (!acceptedRequest.changes) {
    await privateChannel.delete("A solicitação foi cancelada durante a criação do canal.").catch(error => {
      console.error(`Não foi possível remover o canal do match cancelado ${requestId}:`, error);
    });
    await interaction.editReply({
      content: "A solicitação foi cancelada e nenhum canal de conversa foi mantido.",
      embeds: [],
      components: []
    });
    return;
  }
  db.prepare(`
    UPDATE tinder_match_requests
    SET status = 'accepted', private_channel_id = ?
    WHERE guild_id = ? AND sender_id = ? AND recipient_id = ? AND status = 'pending'
  `).run(privateChannel.id, request.guild_id, request.recipient_id, request.sender_id);

  await privateChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xeb459e)
        .setTitle("Match aceito! 💞")
        .setDescription(`<@${request.sender_id}> e <@${request.recipient_id}>, esta conversa é privada.`)
    ],
    allowedMentions: { parse: [] }
  }).catch(error => {
    console.error(`Não foi possível enviar a mensagem inicial no canal do match ${requestId}:`, error);
  });

  let senderNotificationWarning = "";
  try {
    const sender = await client.users.fetch(request.sender_id);
    await sender.send(`Seu match foi aceito! A conversa privada está em <#${privateChannel.id}>.`);
  } catch (error) {
    console.error(`Não foi possível avisar o usuário ${request.sender_id} sobre o match ${requestId}:`, error);
    senderNotificationWarning = " Não consegui avisar a outra pessoa por DM; ela ainda pode abrir o canal pela lista do servidor.";
  }
  await interaction.editReply({
    content: `Vocês deram match! A conversa privada foi criada em <#${privateChannel.id}>.${senderNotificationWarning}`,
    embeds: [],
    components: []
  });
}

async function handleTinderButton(interaction) {
  const [, action, parameter] = interaction.customId.split(":");
  if (action === "create") {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tinder:consent:${interaction.user.id}`)
        .setLabel("Confirmo, continuar")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("tinder:cancel")
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({
      content: "Confirme que você tem **18 anos ou mais** e que autoriza publicar no canal de perfis sua foto/vídeo, bio, gênero, idade e cidade. Não envie conteúdo íntimo ou informações que não queira tornar públicas.",
      components: [row],
      ephemeral: true
    });
  }
  if (action === "consent") {
    if (parameter !== interaction.user.id) {
      return interaction.reply({ content: "Somente quem iniciou o cadastro pode confirmar.", ephemeral: true });
    }
    return interaction.showModal(createTinderProfileModal());
  }
  if (action === "cancel") {
    return interaction.update({ content: "Ação cancelada.", components: [] });
  }
  if (action === "delete") {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("tinder:delete-confirm")
        .setLabel("Sim, remover")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("tinder:cancel")
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({
      content: "Tem certeza de que deseja remover seu perfil público e cancelar solicitações pendentes?",
      components: [row],
      ephemeral: true
    });
  }
  if (action === "delete-confirm") return removeTinderProfile(interaction);
  if (action === "matches") return showTinderMatches(interaction);
  if (action === "like") return handleTinderLike(interaction, parameter);
  if (action === "pass") return handleTinderPass(interaction, parameter);
  if (action === "accept" || action === "decline") {
    return handleTinderRequestResponse(interaction, Number(parameter), action === "accept");
  }
  return interaction.reply({ content: "Esta ação do Tinder não é reconhecida.", ephemeral: true });
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

function isValidHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isValidDiscordInviteUrl(value) {
  try {
    const url = new URL(value);
    const isDiscordGg = ["discord.gg", "www.discord.gg"].includes(url.hostname);
    const isDiscordInvite = ["discord.com", "www.discord.com"].includes(url.hostname) &&
      url.pathname.startsWith("/invite/");
    return url.protocol === "https:" && (isDiscordGg || isDiscordInvite);
  } catch {
    return false;
  }
}

function isValidVideoAttachment(attachment) {
  return (attachment.contentType && attachment.contentType.startsWith("video/")) ||
    /\.(mp4|mov|webm|m4v)$/i.test(attachment.name || "");
}

async function handleEmojiCommand(message, args) {
  const [kind, name, ...tagParts] = args.trim().split(/\s+/);
  const isEmoji = kind?.toLowerCase() === "emoji";
  const isSticker = kind?.toLowerCase() === "figurinha";
  const usage = [
    "Anexe um arquivo que você criou ou tem autorização para usar:",
    "`!emj emoji nome` + PNG/JPG/GIF (até 256 KB)",
    "`!emj figurinha nome tag` + PNG/APNG/JSON/GIF (até 512 KB)"
  ].join("\n");

  if ((!isEmoji && !isSticker) || !name || (isSticker && !tagParts.length)) {
    await message.reply(usage);
    return;
  }
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(name) || (isSticker && name.length > 30)) {
    await message.reply("O nome deve ter de 2 a 32 caracteres: letras, números e `_` (figurinhas: no máximo 30).");
    return;
  }
  if (isSticker && tagParts.join(" ").length > 200) {
    await message.reply("A tag da figurinha pode ter no máximo 200 caracteres.");
    return;
  }
  if (message.attachments.size !== 1) {
    await message.reply("Anexe exatamente um arquivo ao comando.");
    return;
  }

  const attachment = message.attachments.first();
  const extension = attachment.name.match(/\.[^.]+$/)?.[0].toLowerCase();
  const allowedExtensions = isEmoji
    ? [".png", ".jpg", ".jpeg", ".gif"]
    : [".png", ".apng", ".json", ".gif"];
  const maxBytes = isEmoji ? 256 * 1024 : 512 * 1024;
  if (!extension || !allowedExtensions.includes(extension)) {
    await message.reply(`Formato de arquivo não aceito. Formatos válidos: ${allowedExtensions.join(", ")}.`);
    return;
  }
  if (attachment.size > maxBytes) {
    await message.reply(`O arquivo excede o limite de ${isEmoji ? "256 KB" : "512 KB"}.`);
    return;
  }

  if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    await message.reply("Você precisa da permissão **Gerenciar expressões** para usar este comando.");
    return;
  }

  try {
    const botMember = message.guild.members.me || await message.guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
      await message.reply("O bot precisa da permissão **Gerenciar expressões** neste servidor.");
      return;
    }

    const assetUrl = new URL(attachment.url);
    if (assetUrl.protocol !== "https:" || assetUrl.hostname !== "cdn.discordapp.com") {
      await message.reply("O anexo precisa ser enviado diretamente nesta mensagem do Discord.");
      return;
    }

    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`Download do anexo falhou com HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await message.reply(`O arquivo excede o limite de ${isEmoji ? "256 KB" : "512 KB"}.`);
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      await message.reply(`O arquivo excede o limite de ${isEmoji ? "256 KB" : "512 KB"}.`);
      return;
    }

    if (isEmoji) {
      const created = await message.guild.emojis.create({
        attachment: buffer,
        name,
        reason: `Adicionado por ${message.author.id} via !emj`
      });
      await message.reply(`Emoji ${created} adicionado ao servidor.`);
      return;
    }

    const created = await message.guild.stickers.create({
      file: new AttachmentBuilder(buffer, { name: `${name}${extension}` }),
      name,
      tags: tagParts.join(" "),
      reason: `Adicionado por ${message.author.id} via !emj`
    });
    await message.reply(`Figurinha **${created.name}** adicionada ao servidor.`);
  } catch (error) {
    console.error("Erro ao adicionar emoji/figurinha:", error);
    await message.reply(
      "Não consegui adicionar o arquivo. Confira as permissões do bot, os limites do servidor e o formato/tamanho aceito."
    );
  }
}

function postButtons(postId, tiktokUrl, instagramUrl, buttonStyle = ButtonStyle.Primary) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`like:${postId}`)
      .setLabel(String(getLikeCount(postId)))
      .setEmoji({ id: "1571330274531213402", name: "1327037490477010984", animated: true })
      .setStyle(buttonStyle),
    new ButtonBuilder()
      .setCustomId(`comment:${postId}`)
      .setLabel("Comentar")
      .setEmoji({ id: "1571332054128402462", name: "7567" })
      .setStyle(buttonStyle),
    new ButtonBuilder()
      .setCustomId(`viewcomments:${postId}`)
      .setLabel("Ver comentários")
      .setEmoji({ id: "1571330785422606396", name: "Usurio" })
      .setStyle(buttonStyle),
    new ButtonBuilder()
      .setCustomId(`viewlikes:${postId}`)
      .setLabel("Ver curtidas")
      .setEmoji({ id: "1571330704434798776", name: "gray" })
      .setStyle(buttonStyle)
  );

  const rows = [row];
  const socials = [];
  if (instagramUrl) socials.push(new ButtonBuilder()
    .setLabel("Instagram").setEmoji("📸").setStyle(ButtonStyle.Link).setURL(instagramUrl));
  if (tiktokUrl) socials.push(new ButtonBuilder()
    .setLabel("TikTok").setEmoji({ id: "1571331659008315553", name: "6621_tiktok" })
    .setStyle(ButtonStyle.Link).setURL(tiktokUrl));
  if (socials.length) rows.push(new ActionRowBuilder().addComponents(...socials));
  return rows;
}

function getLikeCount(postId) {
  return db.prepare("SELECT COUNT(*) AS total FROM likes WHERE post_id = ?").get(postId).total;
}

function getCommentCount(postId) {
  return db.prepare("SELECT COUNT(*) AS total FROM comments WHERE post_id = ?").get(postId).total;
}

function getLikesPagePayload(postId, requestedPage = 0) {
  const likes = db.prepare(
    "SELECT user_id FROM likes WHERE post_id = ? ORDER BY rowid"
  ).all(postId);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(likes.length / pageSize));
  const page = Math.min(Math.max(requestedPage, 0), pageCount - 1);
  const pageLikes = likes.slice(page * pageSize, (page + 1) * pageSize);
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`❤️ Quem curtiu (${likes.length})`)
    .setDescription(
      pageLikes.length
        ? pageLikes.map(like => `• <@${like.user_id}>`).join("\n")
        : "Ainda ninguém curtiu esta publicação."
    )
    .setFooter({
      text: pageCount > 1
        ? `Página ${page + 1} de ${pageCount}. As menções não enviam notificações.`
        : "As menções não enviam notificações."
    });

  const components = pageCount > 1
    ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`likespage:${postId}:${page - 1}`)
        .setLabel("Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`likespage:${postId}:${page + 1}`)
        .setLabel("Próxima")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === pageCount - 1)
    )]
    : [];

  return { embeds: [embed], components };
}

function createPostComponents(post, videoUrl) {
  const config = getGuildConfig(post.guild_id);
  const discordNick = (post.discord_nick || `<@${post.author_id}>`)
    .replace(/[\r\n]/g, " ")
    .replace(/@everyone|@here/g, "@​$&");
  const card = new ContainerBuilder()
    .setAccentColor(0x000000)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Influencer:** <@${post.author_id}>\n**Discord:** ${discordNick}`
      )
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(videoUrl)
      )
    )
    .addActionRowComponents(...postButtons(post.id, post.tiktok_url, post.instagram_url, config.buttonStyle));

  return [
    new TextDisplayBuilder().setContent(`Nova publicação de <@${post.author_id}>`),
    card
  ];
}

async function refreshPost(postId) {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
  if (!post || !post.message_id) return;

  try {
    const channel = await client.channels.fetch(post.channel_id);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(post.message_id);
    if (message.flags.has(MessageFlags.IsComponentsV2)) {
      const attachment = message.attachments.first();
      await message.edit({
        flags: MessageFlags.IsComponentsV2,
        components: createPostComponents(
          post,
          attachment ? `attachment://${attachment.name}` : post.video_url
        ),
        attachments: [...message.attachments.values()],
        allowedMentions: { parse: [] }
      });
    } else {
      const embed = EmbedBuilder.from(message.embeds[0])
        .setColor(getGuildConfig(post.guild_id).panelColor)
        .setFields(
          { name: "Curtidas", value: `❤️ ${getLikeCount(postId)}`, inline: true },
          { name: "Comentários", value: `💬 ${getCommentCount(postId)}`, inline: true }
        );
      await message.edit({
        embeds: [embed],
        components: postButtons(postId, post.tiktok_url, post.instagram_url, getGuildConfig(post.guild_id).buttonStyle)
      });
    }
  } catch (error) {
    console.error("Não foi possível atualizar a publicação:", error.message);
  }
}

async function refreshGuildConfiguration(guildId) {
  const panels = db.prepare(
    "SELECT channel_id, message_id FROM panel_messages WHERE guild_id = ?"
  ).all(guildId);

  for (const panel of panels) {
    try {
      const channel = await client.channels.fetch(panel.channel_id);
      if (!channel?.isTextBased()) throw new Error("Canal do painel indisponível.");
      const message = await channel.messages.fetch(panel.message_id);
      await message.edit(createPanelPayload(guildId));
    } catch (error) {
      console.error(`Não foi possível atualizar o painel ${panel.message_id}:`, error.message);
    }
  }

  const posts = db.prepare("SELECT id FROM posts WHERE guild_id = ?").all(guildId);
  for (const post of posts) await refreshPost(post.id);
}

client.once("ready", async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  inviteSnapshotInitialization = initializeInviteSnapshots().catch(error => {
    console.error("Não foi possível inicializar o rastreamento de convites:", error);
  });
  await inviteSnapshotInitialization;

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );
    console.log("Comando /painel registrado.");
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }

  await connectToVoiceChannel();
  startHourlyRoleMentionSchedule();

  await expireTimedMutes();
  const muteExpiryTimer = setInterval(() => {
    expireTimedMutes().catch(error => console.error("Erro ao verificar mutes expirados:", error));
  }, 30_000);
  muteExpiryTimer.unref();

  const existingPosts = db.prepare("SELECT id FROM posts WHERE message_id IS NOT NULL").all();
  for (const post of existingPosts) await refreshPost(post.id);
  if (existingPosts.length) {
    console.log(`Botões atualizados em ${existingPosts.length} publicações.`);
  }

  await refreshTinderProfiles();

  const updateServerTagVerifications = () => {
    if (serverTagAuditRunning) return;
    serverTagAuditRunning = true;
    auditServerTagVerifications()
      .catch(error => console.error("Erro ao sincronizar cargos de tag:", error))
      .finally(() => {
        serverTagAuditRunning = false;
      });
  };
  updateServerTagVerifications();
  const serverTagAuditTimer = setInterval(updateServerTagVerifications, 5 * 60_000);
  serverTagAuditTimer.unref();

  const updateLiveStatuses = () => {
    if (liveStatusUpdateRunning) return;
    liveStatusUpdateRunning = true;
    refreshLiveStatusMessages()
      .catch(error => console.error("Erro ao atualizar os status de voz:", error))
      .finally(() => {
        liveStatusUpdateRunning = false;
      });
  };
  updateLiveStatuses();
  const liveStatusTimer = setInterval(updateLiveStatuses, 5_000);
  liveStatusTimer.unref();
});

client.on("guildMemberAdd", member => {
  if (member.user.bot) return;
  inviteTrackingQueue = inviteTrackingQueue
    .then(() => handleGuildMemberJoin(member))
    .catch(error => console.error(`Erro ao registrar a entrada de ${member.id}:`, error));
});

client.on("guildMemberUpdate", (oldMember, newMember) => {
  const config = db.prepare(
    "SELECT required_tag, role_id FROM server_tag_panels WHERE guild_id = ?"
  ).get(newMember.guild.id);
  if (!config || !newMember.roles.cache.has(config.role_id)) return;

  syncServerTagRole(newMember, config).catch(error => {
    console.error(`Erro ao sincronizar a tag de ${newMember.id}:`, error);
  });
});

client.on("guildMemberRemove", member => {
  db.prepare("DELETE FROM server_tag_verifications WHERE guild_id = ? AND user_id = ?")
    .run(member.guild.id, member.id);
});

client.on("inviteCreate", invite => {
  handleInviteCreated(invite).catch(error => {
    console.error(`Erro ao registrar a criação do convite ${invite.code}:`, error);
  });
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "mute") {
      return await handleMuteCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "unmute") {
      return await handleUnmuteCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "embed") {
      return await handleEmbedCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "status") {
      return await handleLiveStatusCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "tinder") {
      if (interaction.options.getSubcommand() === "painel") {
        return await handleTinderPanelCommand(interaction);
      }
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "verificacao-tag") {
      if (interaction.options.getSubcommand() === "painel") {
        return await handleServerTagPanelCommand(interaction);
      }
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "configurar-painel") {
      if (!interaction.inGuild() || !memberHasConfigRole(interaction.member)) {
        return interaction.reply({ content: "Somente membros com o cargo autorizado podem alterar as configurações.", ephemeral: true });
      }
      await trackPanelsInChannel(interaction.channel, interaction.guildId);
      return interaction.reply({ ...createConfigDashboardPayload(interaction.guildId), ephemeral: true });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "painel") {
      if (!interaction.inGuild() ||
          !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "Somente administradores podem usar este comando.", ephemeral: true });
      }

      await interaction.reply({ content: "Painel enviado.", ephemeral: true });
      await sendPanel(interaction.channel, interaction.guildId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("tinder:")) {
      return await handleTinderButton(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith("server-tag:verify:")) {
      const panelGuildId = interaction.customId.split(":")[2];
      if (!interaction.inGuild() || panelGuildId !== interaction.guildId) {
        return interaction.reply({ content: "Este painel pertence a outro servidor.", ephemeral: true });
      }
      return await handleServerTagVerification(interaction);
    }

    if (interaction.isButton() && interaction.customId === "open_publish") {
      if (interaction.inGuild()) {
        registerPanelMessage(interaction.guildId, interaction.channelId, interaction.message.id);
      }
      const modal = new ModalBuilder()
        .setCustomId("publish_modal")
        .setTitle("Enviar publicação");

      const tiktok = new TextInputBuilder()
        .setCustomId("tiktok")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setPlaceholder("https://www.tiktok.com/@usuario/video/...");

      const instagram = new TextInputBuilder()
        .setCustomId("instagram")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setPlaceholder("https://www.instagram.com/...");

      const video = new FileUploadBuilder()
        .setCustomId("video")
        .setRequired(true)
        .setMinValues(1)
        .setMaxValues(1)
        .setFileTypes("video", ".mp4", ".mov", ".webm", ".m4v");

      modal.addLabelComponents(
        new LabelBuilder()
          .setLabel("Link do TikTok (opcional)")
          .setTextInputComponent(tiktok),
        new LabelBuilder()
          .setLabel("Link do Instagram (opcional)")
          .setTextInputComponent(instagram),
        new LabelBuilder()
          .setLabel("Vídeo")
          .setDescription("Anexe um vídeo MP4, MOV, WEBM ou M4V.")
          .setFileUploadComponent(video)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("config:")) {
      if (!interaction.inGuild() || !memberHasConfigRole(interaction.member)) {
        return interaction.reply({ content: "Somente membros com o cargo autorizado podem alterar as configurações.", ephemeral: true });
      }
      const kind = interaction.customId.slice("config:".length);
      if (!["content", "images", "channel"].includes(kind)) return;
      await interaction.showModal(createSettingsModal(kind, interaction.guildId));
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "config:button_style") {
      if (!interaction.inGuild() || !memberHasConfigRole(interaction.member)) {
        return interaction.reply({ content: "Somente membros com o cargo autorizado podem alterar as configurações.", ephemeral: true });
      }
      const style = interaction.values[0];
      if (!Object.prototype.hasOwnProperty.call(buttonStyles, style)) {
        return interaction.reply({ content: "A cor selecionada não é válida.", ephemeral: true });
      }
      await interaction.deferUpdate();
      setGuildSetting(interaction.guildId, "button_style", style);
      await refreshGuildConfiguration(interaction.guildId);
      await interaction.editReply(createConfigDashboardPayload(interaction.guildId));
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "tinder:profile") {
      return await handleTinderProfileSubmit(interaction);
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

      const attachment = interaction.fields.getUploadedFiles("video")?.first();
      if (!attachment) {
        return interaction.reply({ content: "Anexe um vídeo antes de enviar o formulário.", ephemeral: true });
      }
      if (!isValidVideoAttachment(attachment)) {
        return interaction.reply({
          content: "O arquivo anexado não parece ser um vídeo. Use MP4, MOV, WEBM ou M4V.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const postChannelId = getGuildConfig(interaction.guildId).postChannelId;
        if (!postChannelId) {
          await interaction.editReply(
            "Nenhum canal de publicações foi configurado. Peça a um administrador para usar `!painel configurar canal #canal`."
          );
          return;
        }

        const postChannel = await client.channels.fetch(postChannelId);
        if (!postChannel || !postChannel.isTextBased()) {
          await interaction.editReply("O canal de publicações configurado não foi encontrado.");
          return;
        }

        const videoResponse = await fetch(attachment.url);
        if (!videoResponse.ok) throw new Error("Não foi possível baixar o vídeo anexado.");
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        const discordNick = interaction.member?.displayName ||
          interaction.member?.nick ||
          interaction.user.globalName ||
          interaction.user.username;

        const postInfo = db.prepare(`
          INSERT INTO posts (guild_id, channel_id, author_id, discord_nick, video_url, video_name, tiktok_url, instagram_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          interaction.guildId,
          postChannel.id,
          interaction.user.id,
          discordNick,
          attachment.url,
          attachment.name || "video.mp4",
          tiktokUrl,
          instagramUrl
        );

        const postId = Number(postInfo.lastInsertRowid);
        const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
        const videoName = attachment.name || "video.mp4";

        const sent = await postChannel.send({
          flags: MessageFlags.IsComponentsV2,
          components: createPostComponents(post, `attachment://${videoName}`),
          files: [new AttachmentBuilder(videoBuffer, { name: videoName })],
          allowedMentions: { users: [interaction.user.id] }
        });

        db.prepare("UPDATE posts SET message_id = ? WHERE id = ?").run(sent.id, postId);
        await interaction.editReply("Seu vídeo foi publicado com sucesso! 🎉");
      } catch (error) {
        console.error("Erro ao publicar vídeo:", error);
        await interaction.editReply(
          "Não consegui publicar o vídeo. Verifique as permissões e o limite de tamanho do Discord."
        );
      }
      return;
    }

    if (interaction.isButton()) {
      const [action, idText, pageText] = interaction.customId.split(":");
      const postId = Number(idText);
      if (!Number.isInteger(postId)) return;

      const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
      if (!post) {
        return interaction.reply({ content: "Essa publicação não foi encontrada.", ephemeral: true });
      }

      if (action === "viewlikes" || action === "likespage") {
        const page = action === "likespage" ? Number(pageText) : 0;
        if (!Number.isInteger(page) || page < 0) {
          return interaction.reply({ content: "Essa página de curtidas não é válida.", ephemeral: true });
        }

        const payload = {
          ...getLikesPagePayload(postId, page),
          allowedMentions: { parse: [] }
        };
        if (action === "likespage") {
          await interaction.update(payload);
        } else {
          await interaction.reply({ ...payload, ephemeral: true });
        }
        return;
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith("config_modal:")) {
      if (!interaction.inGuild() || !memberHasConfigRole(interaction.member)) {
        return interaction.reply({ content: "Somente membros com o cargo autorizado podem alterar as configurações.", ephemeral: true });
      }
      const kind = interaction.customId.slice("config_modal:".length);
      await interaction.deferReply({ ephemeral: true });

      if (kind === "content") {
        const title = interaction.fields.getTextInputValue("title").trim();
        const description = interaction.fields.getTextInputValue("description").trim();
        const footer = interaction.fields.getTextInputValue("footer").trim();
        const nextTitle = title || defaultPanelTitle;
        const nextDescription = description || defaultPanelDescription;
        if (!fitsDiscordEmbedTextLimit(nextTitle, nextDescription, footer)) {
          return interaction.editReply("O título, a descrição e o rodapé juntos não podem ultrapassar 6.000 caracteres.");
        }
        setGuildSetting(interaction.guildId, "panel_title", nextTitle);
        setGuildSetting(interaction.guildId, "panel_description", nextDescription);
        setGuildSetting(interaction.guildId, "panel_footer", footer);
      } else if (kind === "images") {
        const banner = interaction.fields.getTextInputValue("banner").trim();
        const thumbnail = interaction.fields.getTextInputValue("thumbnail").trim();
        if ((banner && !isValidHttpsUrl(banner)) || (thumbnail && !isValidHttpsUrl(thumbnail))) {
          return interaction.editReply("Banner e thumbnail precisam ser URLs HTTPS válidas.");
        }
        setGuildSetting(interaction.guildId, "panel_banner", banner);
        setGuildSetting(interaction.guildId, "panel_thumbnail", thumbnail);
      } else if (kind === "channel") {
        const value = interaction.fields.getTextInputValue("channel").trim();
        if (value) {
          const channelId = value.match(/^<#(\d+)>$/)?.[1] || value;
          if (!/^\d{17,20}$/.test(channelId)) {
            return interaction.editReply("Informe a menção ou o ID de um canal de texto válido.");
          }
          const channel = await interaction.guild.channels.fetch(channelId);
          if (!channel?.isTextBased()) {
            return interaction.editReply("O canal informado não existe ou não aceita mensagens.");
          }
          setGuildSetting(interaction.guildId, "post_channel_id", channel.id);
        } else {
          db.prepare("DELETE FROM guild_settings WHERE guild_id = ? AND setting_key = 'post_channel_id'")
            .run(interaction.guildId);
        }
      } else {
        return interaction.editReply("Essa opção de configuração não é válida.");
      }

      await refreshGuildConfiguration(interaction.guildId);
      await interaction.editReply("Configuração salva e aplicada às mensagens existentes.");
      return;
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
    if (interaction.isRepliable()) {
      try {
        if (interaction.deferred) {
          await interaction.editReply(message);
        } else if (interaction.replied) {
          await interaction.followUp({ content: message, ephemeral: true });
        } else {
          await interaction.reply({ content: message, ephemeral: true });
        }
      } catch (replyError) {
        console.error("Não foi possível informar o erro ao usuário:", replyError);
      }
    }
  }
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const emojiCommand = message.content.match(/^!emj(?:\s+([\s\S]*))?$/i);
  if (emojiCommand) {
    await handleEmojiCommand(message, emojiCommand[1] || "");
    return;
  }

  const command = message.content.match(/^!painel(?:\s+([\s\S]*))?$/i);
  if (command) {
    const args = (command[1] || "").trim();
    const configMatch = args.match(/^configurar(?:\s+([\s\S]*))?$/i);
    if (configMatch) {
      if (!memberHasConfigRole(message.member)) {
        await message.reply("Somente membros com o cargo autorizado podem alterar as configurações.");
        return;
      }

      const setting = (configMatch[1] || "").trim();
      if (!setting) {
        await trackPanelsInChannel(message.channel, message.guild.id);
        try {
          await message.author.send(createConfigDashboardPayload(message.guild.id));
          await message.reply("Enviei o painel de configuração por mensagem direta.");
        } catch (error) {
          console.error("Não foi possível abrir o painel de configuração por mensagem direta:", error);
          await message.reply("Não consegui enviar sua configuração por mensagem direta. Ative as mensagens diretas do servidor e tente novamente.");
        }
        return;
      }

      const [name, ...valueParts] = setting.split(/\s+/);
      const value = valueParts.join(" ").trim();
      const settingNames = {
        canal: "post_channel_id",
        titulo: "panel_title",
        descricao: "panel_description",
        cor: "panel_color",
        banner: "panel_banner",
        thumbnail: "panel_thumbnail",
        rodape: "panel_footer",
        botao: "button_style"
      };
      const settingKey = name && Object.prototype.hasOwnProperty.call(settingNames, name.toLowerCase())
        ? settingNames[name.toLowerCase()]
        : null;

      if (!settingKey || !value) {
        await message.reply(
          "Use `!painel configurar` para abrir o menu visual ou configure `canal`, `titulo`, `descricao`, `cor`, `banner`, `thumbnail`, `rodape` e `botao`."
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
        await refreshGuildConfiguration(message.guild.id);
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
      if (key === "panel_footer" && value.length > 2048) {
        await message.reply("O rodapé pode ter no máximo 2048 caracteres.");
        return;
      }
      if (key === "panel_color" && !/^#?[0-9a-f]{6}$/i.test(value)) {
        await message.reply("A cor deve estar no formato `#RRGGBB`, por exemplo `#000000`.");
        return;
      }
      if ((key === "panel_banner" || key === "panel_thumbnail") && !isValidHttpsUrl(value)) {
        await message.reply("Banner e thumbnail precisam ser URLs HTTPS válidas.");
        return;
      }
      if ((key === "panel_title" || key === "panel_description" || key === "panel_footer")) {
        const config = getGuildConfig(message.guild.id);
        const title = key === "panel_title" ? value : config.panelTitle;
        const description = key === "panel_description" ? value : config.panelDescription;
        const footer = key === "panel_footer" ? value : config.panelFooter;
        if (!fitsDiscordEmbedTextLimit(title, description, footer)) {
          await message.reply("O título, a descrição e o rodapé juntos não podem ultrapassar 6.000 caracteres.");
          return;
        }
      }
      if (key === "button_style") {
        const styleNames = {
          azul: "Primary",
          cinza: "Secondary",
          verde: "Success",
          vermelho: "Danger"
        };
        const style = styleNames[value.toLowerCase()] || value;
        if (!Object.prototype.hasOwnProperty.call(buttonStyles, style)) {
          await message.reply("Cor do botão inválida. Escolha `azul`, `cinza`, `verde` ou `vermelho`.");
          return;
        }
        setGuildSetting(message.guild.id, key, style);
        await refreshGuildConfiguration(message.guild.id);
        await message.reply("Configuração salva e aplicada às mensagens existentes.");
        return;
      }

      setGuildSetting(
        message.guild.id,
        key,
        key === "panel_color" ? value.replace(/^#/, "").toLowerCase() : value
      );
      await refreshGuildConfiguration(message.guild.id);
      await message.reply("Configuração salva e aplicada às mensagens existentes.");
      return;
    }

    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("Somente administradores podem enviar o painel.");
      return;
    }

    await sendPanel(message.channel, message.guild.id);
    return;
  }

});

if (process.env.PORT) {
  const healthServer = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "ok",
        discord: client.isReady() ? "ready" : "connecting"
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  healthServer.listen(Number(process.env.PORT), "0.0.0.0", () => {
    console.log(`Health endpoint listening on port ${process.env.PORT}`);
  });
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
