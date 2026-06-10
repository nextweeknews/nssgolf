"use strict";

require("dotenv").config();

const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  WebhookClient,
  escapeMarkdown,
} = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const {
  GLOBAL_RANK_FIELD_LABELS,
  GLOBAL_RANKS_NO_CS,
  GLOBAL_RANKS_WITH_CS,
  RANK_OPERATION_CONFIGS,
  applyRankUpdate,
  changedFieldsFromUpdate,
  normalizeDiscordId,
  normalizeRankInput,
  orderRankValuesDescending,
} = require("./global-ranks-core");

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const adminRoleId = normalizeDiscordId(
  process.env.DISCORD_ADMIN_ROLE_ID || "1069007873985740890"
);
const supabaseUrl = process.env.NSSGOLF_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRoleKey =
  process.env.NSSGOLF_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const missingSetupMessage =
  "Run bot/discord-member-schema.sql, bot/player-settings-schema.sql, and bot/global-rank-displays-schema.sql in the Supabase SQL editor for this project.";

const rankDisplayConfigs = {
  current_global_rank: {
    commandName: "display_global_ranks",
    title: "Global Ranks",
    rankOrder: GLOBAL_RANKS_WITH_CS,
  },
  max_global_rank_no_cs: {
    commandName: "display_global_max_nocs",
    title: "Global Max Ranks (no cloud saves)",
    rankOrder: GLOBAL_RANKS_NO_CS,
  },
  max_global_rank_cs: {
    commandName: "display_global_max_cs",
    title: "Global Max Ranks (with cloud saves)",
    rankOrder: GLOBAL_RANKS_WITH_CS,
  },
};

const slashSetCommandOperations = {
  set_rank_nocs: "rank_no_cs",
  set_rank_cs: "rank_cs",
  set_max_nocs: "max_no_cs",
  set_max_cs: "max_cs",
};

const messageCommandOperations = {
  ranknocs: "rank_no_cs",
  rankcs: "rank_cs",
  maxnocs: "max_no_cs",
  maxcs: "max_cs",
};

if (!token || !guildId) {
  console.error(
    "Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID. Add them to .env before starting the global ranks bot."
  );
  process.exit(1);
}

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error(
    "Missing NSSGOLF_SUPABASE_URL or NSSGOLF_SUPABASE_SERVICE_ROLE_KEY. The global ranks bot writes to Supabase."
  );
  process.exit(1);
}

function decodeJwtPayload(tokenValue) {
  const parts = tokenValue.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const normalizedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "="
    );
    return JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function assertSupabaseElevatedKey(keyValue) {
  const trimmedKey = String(keyValue || "").trim();

  if (trimmedKey.startsWith("sb_publishable_")) {
    throw new Error(
      "NSSGOLF_SUPABASE_SERVICE_ROLE_KEY is a publishable key. Use a Supabase secret key (sb_secret_...) or legacy service_role JWT key."
    );
  }

  if (trimmedKey.startsWith("sb_secret_")) {
    return;
  }

  const jwtPayload = decodeJwtPayload(trimmedKey);
  if (!jwtPayload) {
    throw new Error(
      "NSSGOLF_SUPABASE_SERVICE_ROLE_KEY is not a recognized Supabase secret key or legacy service_role JWT key."
    );
  }

  if (jwtPayload.role !== "service_role") {
    throw new Error(
      `NSSGOLF_SUPABASE_SERVICE_ROLE_KEY uses the '${jwtPayload.role || "unknown"}' role. Use the legacy service_role JWT key, not the anon key.`
    );
  }
}

assertSupabaseElevatedKey(supabaseServiceRoleKey);

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function isMissingSupabaseTableError(error) {
  return /schema cache|could not find the table|does not exist/i.test(
    error?.message || ""
  );
}

function throwSupabaseError(context, error) {
  if (isMissingSupabaseTableError(error)) {
    throw new Error(`${context}: ${error.message}. ${missingSetupMessage}`);
  }

  throw new Error(`${context}: ${error.message}`);
}

function chunkRows(rows, size = 500) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function slashCommands() {
  const displayCommands = Object.values(rankDisplayConfigs).map((config) =>
    new SlashCommandBuilder()
      .setName(config.commandName)
      .setDescription(`Create or refresh the ${config.title} display.`)
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  );

  const setCommands = Object.entries(slashSetCommandOperations).map(
    ([commandName, operation]) => {
      const config = RANK_OPERATION_CONFIGS[operation];
      return new SlashCommandBuilder()
        .setName(commandName)
        .setDescription(`Set a player's ${config.currentLabel || config.maxLabel}.`)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
          option
            .setName("player")
            .setDescription("The Discord player to update.")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("rank")
            .setDescription("Rank value, for example S9, ∞3, or inf3.")
            .setRequired(true)
        );
    }
  );

  return [...displayCommands, ...setCommands].map((command) => command.toJSON());
}

async function registerSlashCommands() {
  await client.application.commands.set(slashCommands(), guildId);
}

function memberIsRankAdmin(member) {
  if (!member) {
    return false;
  }

  if (typeof member.permissions?.has === "function" && member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  if (member.permissions) {
    try {
      if ((BigInt(member.permissions) & PermissionFlagsBits.Administrator) !== 0n) {
        return true;
      }
    } catch {}
  }

  if (!adminRoleId) {
    return false;
  }

  if (member.roles?.cache?.has(adminRoleId)) {
    return true;
  }

  return Array.isArray(member.roles) && member.roles.includes(adminRoleId);
}

function displayNameForMemberRow(member) {
  return (
    String(member?.display_name || "").trim() ||
    String(member?.username || "").trim() ||
    normalizeDiscordId(member?.discord_user_id) ||
    "Player"
  );
}

function escapedDisplayName(name) {
  return escapeMarkdown(String(name || "Player").trim(), {
    codeBlock: true,
    inlineCode: true,
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
    spoiler: true,
    codeBlockContent: true,
    inlineCodeContent: true,
  });
}

async function upsertDiscordMember(guildMember) {
  if (!guildMember?.guild?.id || !guildMember?.user?.id) {
    return;
  }

  const row = {
    guild_id: guildMember.guild.id,
    discord_user_id: guildMember.user.id,
    username: guildMember.user.username,
    global_name: guildMember.user.globalName,
    discriminator: guildMember.user.discriminator,
    is_bot: guildMember.user.bot,
    display_name: guildMember.displayName || guildMember.user.username,
    nickname: guildMember.nickname,
    avatar_url: guildMember.user.displayAvatarURL({ size: 256, extension: "png" }),
    server_avatar_url: guildMember.displayAvatarURL({ size: 256, extension: "png" }),
    joined_at: guildMember.joinedAt ? guildMember.joinedAt.toISOString() : null,
    is_current_member: true,
    last_scanned_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("discord_guild_members")
    .upsert(row, { onConflict: "guild_id,discord_user_id" });

  if (error) {
    throwSupabaseError("Discord member upsert failed", error);
  }
}

async function fetchGuildMember(discordUserId) {
  const guild = await client.guilds.fetch(guildId);
  return guild.members.fetch(discordUserId);
}

async function loadSettingsByDiscordId(discordUserId) {
  const { data, error } = await supabase
    .from("player_settings")
    .select("discord_user_id,current_global_rank,max_global_rank_no_cs,max_global_rank_cs")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (error) {
    throwSupabaseError("Player settings lookup failed", error);
  }

  return data || null;
}

async function loadProfileUserIdByDiscordId(discordUserId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,discord_user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (error) {
    throwSupabaseError("Profile lookup failed", error);
  }

  return data?.user_id || "";
}

async function ensureSettingsRow(discordUserId) {
  const existingSettings = await loadSettingsByDiscordId(discordUserId);
  if (existingSettings) {
    return existingSettings;
  }

  const userId = await loadProfileUserIdByDiscordId(discordUserId);
  const { data, error } = await supabase
    .from("player_settings")
    .insert({
      user_id: userId || null,
      discord_user_id: discordUserId,
    })
    .select("discord_user_id,current_global_rank,max_global_rank_no_cs,max_global_rank_cs")
    .single();

  if (error) {
    if (error.code === "23505") {
      return loadSettingsByDiscordId(discordUserId);
    }

    throwSupabaseError("Player settings creation failed", error);
  }

  return data;
}

async function saveSettings(discordUserId, settings) {
  const payload = {
    current_global_rank: settings.current_global_rank,
    max_global_rank_no_cs: settings.max_global_rank_no_cs,
    max_global_rank_cs: settings.max_global_rank_cs,
  };

  const { data, error } = await supabase
    .from("player_settings")
    .update(payload)
    .eq("discord_user_id", discordUserId)
    .select("discord_user_id,current_global_rank,max_global_rank_no_cs,max_global_rank_cs")
    .single();

  if (error) {
    throwSupabaseError("Player settings update failed", error);
  }

  return data;
}

function formatUpdateMessage(discordUserId, updateResult) {
  const changes = updateResult?.changes || [];
  if (!changes.length) {
    return `<@${discordUserId}> No global rank changes were needed.`;
  }

  const changeText = changes
    .map((change) => `${change.label} updated to **${change.rank}**`)
    .join("; ");

  return `<@${discordUserId}> ${changeText}`;
}

function parseMessageCommand(content) {
  const match = String(content || "").match(/^!(ranknocs|rankcs|maxnocs|maxcs)(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return null;
  }

  return {
    command: match[1].toLowerCase(),
    rankText: String(match[2] || "").trim(),
  };
}

async function rankForOperation(existingSettings, operation, rankText) {
  if (rankText) {
    return rankText;
  }

  if (operation === "max_no_cs" || operation === "max_cs") {
    const currentRank = normalizeRankInput(existingSettings?.current_global_rank);
    if (currentRank) {
      return currentRank;
    }
  }

  throw new Error(
    "Include a rank value, like S9 or inf3. For max commands, you can also set your current rank first."
  );
}

async function applyPlayerRankOperation(discordUserId, operation, rankText) {
  const settings = await ensureSettingsRow(discordUserId);
  const rankValue = await rankForOperation(settings, operation, rankText);
  const updateResult = applyRankUpdate(settings, operation, rankValue);
  await saveSettings(discordUserId, updateResult.settings);
  return updateResult;
}

async function loadRankRows(rankKey, rankOrder) {
  const { data: settingsRows, error: settingsError } = await supabase
    .from("player_settings")
    .select(`discord_user_id,${rankKey}`)
    .not(rankKey, "is", null);

  if (settingsError) {
    throwSupabaseError("Global rank settings lookup failed", settingsError);
  }

  const cleanSettingsRows = (settingsRows || [])
    .map((row) => ({
      discord_user_id: normalizeDiscordId(row.discord_user_id),
      rank: normalizeRankInput(row[rankKey], rankOrder),
    }))
    .filter((row) => row.discord_user_id && row.rank);

  const memberIds = [...new Set(cleanSettingsRows.map((row) => row.discord_user_id))];
  const memberRows = [];

  for (const idChunk of chunkRows(memberIds)) {
    if (!idChunk.length) {
      continue;
    }

    const { data, error } = await supabase
      .from("discord_guild_members")
      .select("discord_user_id,username,display_name,is_current_member")
      .eq("guild_id", guildId)
      .in("discord_user_id", idChunk);

    if (error) {
      throwSupabaseError("Discord members lookup failed", error);
    }

    memberRows.push(...(data || []));
  }

  const membersById = new Map(
    memberRows
      .filter((member) => member.is_current_member !== false)
      .map((member) => [normalizeDiscordId(member.discord_user_id), member])
  );

  return cleanSettingsRows
    .map((row) => ({
      ...row,
      member: membersById.get(row.discord_user_id),
    }))
    .filter((row) => row.member);
}

function chunkRankSections(sections, maxLength = 3800) {
  const chunks = [];
  let currentChunk = "";

  for (const section of sections) {
    const nextChunk = currentChunk ? `${currentChunk}\n\n${section}` : section;
    if (nextChunk.length <= maxLength) {
      currentChunk = nextChunk;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    currentChunk = section.length > maxLength ? `${section.slice(0, maxLength - 3)}...` : section;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length ? chunks : ["_No players listed yet._"];
}

async function buildRankEmbeds(rankKey) {
  const config = rankDisplayConfigs[rankKey];
  if (!config) {
    throw new Error(`Unknown rank display key: ${rankKey}`);
  }

  const rows = await loadRankRows(rankKey, config.rankOrder);
  const rankValues = orderRankValuesDescending(
    rows.map((row) => row.rank),
    config.rankOrder
  );
  const sections = rankValues.map((rank) => {
    const names = rows
      .filter((row) => row.rank === rank)
      .map((row) => escapedDisplayName(displayNameForMemberRow(row.member)))
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

    return `**${rank}**\n${names.map((name) => `- ${name}`).join("\n")}`;
  });

  const descriptionChunks = chunkRankSections(sections);
  return descriptionChunks.slice(0, 10).map((description, index) => {
    const title =
      descriptionChunks.length > 1
        ? `${config.title} (${index + 1}/${Math.min(descriptionChunks.length, 10)})`
        : config.title;

    return new EmbedBuilder()
      .setTitle(title)
      .setColor(0x2f855a)
      .setDescription(description)
      .setFooter({ text: GLOBAL_RANK_FIELD_LABELS[rankKey] })
      .setTimestamp(new Date());
  });
}

async function loadDisplayRow(channelId, rankKey) {
  const { data, error } = await supabase
    .from("discord_global_rank_display_messages")
    .select("guild_id,channel_id,rank_key,webhook_id,webhook_token,message_id")
    .eq("guild_id", guildId)
    .eq("channel_id", channelId)
    .eq("rank_key", rankKey)
    .maybeSingle();

  if (error) {
    throwSupabaseError("Global rank display lookup failed", error);
  }

  return data || null;
}

async function saveDisplayRow(row) {
  const { error } = await supabase
    .from("discord_global_rank_display_messages")
    .upsert(row, { onConflict: "guild_id,channel_id,rank_key" });

  if (error) {
    throwSupabaseError("Global rank display save failed", error);
  }
}

async function deleteDisplayRow(row) {
  const { error } = await supabase
    .from("discord_global_rank_display_messages")
    .delete()
    .eq("guild_id", row.guild_id)
    .eq("channel_id", row.channel_id)
    .eq("rank_key", row.rank_key);

  if (error) {
    throwSupabaseError("Global rank display cleanup failed", error);
  }
}

function webhookClientForRow(row) {
  return new WebhookClient({
    id: row.webhook_id,
    token: row.webhook_token,
  });
}

const displayPermissionChecks = [
  ["View Channel", PermissionFlagsBits.ViewChannel],
  ["Send Messages", PermissionFlagsBits.SendMessages],
  ["Embed Links", PermissionFlagsBits.EmbedLinks],
  ["Manage Webhooks", PermissionFlagsBits.ManageWebhooks],
];

function missingDisplayPermissions(channel) {
  const permissions = channel?.permissionsFor?.(client.user);
  if (!permissions) {
    return ["View Channel", "Send Messages", "Embed Links", "Manage Webhooks"];
  }

  return displayPermissionChecks
    .filter(([, permission]) => !permissions.has(permission))
    .map(([label]) => label);
}

function assertDisplayPermissions(channel) {
  const missingPermissions = missingDisplayPermissions(channel);
  if (!missingPermissions.length) {
    return;
  }

  throw new Error(
    `I need these channel permissions to create the public leaderboard webhook message: ${missingPermissions.join(", ")}.`
  );
}

async function editDisplayRow(row, embeds) {
  const webhookClient = webhookClientForRow(row);
  await webhookClient.editMessage(row.message_id, {
    embeds,
    allowedMentions: { parse: [] },
  });
}

async function ensureWebhook(channel) {
  if (!channel || typeof channel.createWebhook !== "function") {
    throw new Error("Use this command in a server text channel where the bot can manage webhooks.");
  }

  assertDisplayPermissions(channel);

  const webhookName = "NSS Golf Rank Displays";
  const webhooks = await channel.fetchWebhooks();
  const existingWebhook = webhooks.find(
    (webhook) =>
      webhook.owner?.id === client.user.id &&
      webhook.name === webhookName &&
      webhook.token
  );

  if (existingWebhook) {
    return existingWebhook;
  }

  return channel.createWebhook({
    name: webhookName,
    reason: "Create NSS Golf global rank display messages.",
  });
}

async function createOrUpdateDisplay(channel, rankKey, createdByDiscordUserId) {
  const embeds = await buildRankEmbeds(rankKey);
  const existingRow = await loadDisplayRow(channel.id, rankKey);

  if (existingRow) {
    try {
      await editDisplayRow(existingRow, embeds);
      return { action: "updated", messageId: existingRow.message_id };
    } catch (error) {
      console.warn(
        `Unable to edit existing ${rankKey} display ${existingRow.message_id}; creating a replacement.`,
        error
      );
      await deleteDisplayRow(existingRow);
    }
  }

  const webhook = await ensureWebhook(channel);
  if (!webhook?.id || !webhook?.token) {
    throw new Error("Unable to create a usable webhook for this channel.");
  }

  const message = await webhook.send({
    embeds,
    allowedMentions: { parse: [] },
    wait: true,
  });

  await saveDisplayRow({
    guild_id: guildId,
    channel_id: channel.id,
    rank_key: rankKey,
    webhook_id: webhook.id,
    webhook_token: webhook.token,
    message_id: message.id,
    created_by_discord_user_id: createdByDiscordUserId,
  });

  return { action: "created", messageId: message.id };
}

async function loadDisplayRowsForFields(rankKeys) {
  const cleanRankKeys = [...new Set(rankKeys.filter((rankKey) => rankDisplayConfigs[rankKey]))];
  if (!cleanRankKeys.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("discord_global_rank_display_messages")
    .select("guild_id,channel_id,rank_key,webhook_id,webhook_token,message_id")
    .eq("guild_id", guildId)
    .in("rank_key", cleanRankKeys);

  if (error) {
    throwSupabaseError("Global rank display lookup failed", error);
  }

  return data || [];
}

async function refreshDisplaysForFields(rankKeys) {
  const rows = await loadDisplayRowsForFields(rankKeys);

  for (const row of rows) {
    try {
      const embeds = await buildRankEmbeds(row.rank_key);
      await editDisplayRow(row, embeds);
    } catch (error) {
      console.warn(`Unable to refresh rank display ${row.message_id}.`, error);
    }
  }
}

async function handleDisplayInteraction(interaction, rankKey) {
  if (!memberIsRankAdmin(interaction.member)) {
    await interaction.reply({
      content: "Only server admins can use this command.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await createOrUpdateDisplay(
    interaction.channel,
    rankKey,
    interaction.user.id
  );

  const config = rankDisplayConfigs[rankKey];
  await interaction.editReply(
    `${config.title} display ${result.action} in this channel.`
  );
}

async function handleSetInteraction(interaction, operation) {
  if (!memberIsRankAdmin(interaction.member)) {
    await interaction.reply({
      content: "Only server admins can use this command.",
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser("player", true);
  const rankText = interaction.options.getString("rank", true);
  if (targetUser.bot) {
    await interaction.reply({
      content: "Global ranks can only be set for player accounts.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  const targetMember = await fetchGuildMember(targetUser.id);
  await upsertDiscordMember(targetMember);

  const updateResult = await applyPlayerRankOperation(targetUser.id, operation, rankText);
  const changedFields = changedFieldsFromUpdate(updateResult);
  await refreshDisplaysForFields(changedFields);

  await interaction.editReply({
    content: formatUpdateMessage(targetUser.id, updateResult),
    allowedMentions: { users: [targetUser.id] },
  });
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.guildId !== guildId) {
    return;
  }

  try {
    const displayEntry = Object.entries(rankDisplayConfigs).find(
      ([, config]) => config.commandName === interaction.commandName
    );
    if (displayEntry) {
      await handleDisplayInteraction(interaction, displayEntry[0]);
      return;
    }

    const operation = slashSetCommandOperations[interaction.commandName];
    if (operation) {
      await handleSetInteraction(interaction, operation);
    }
  } catch (error) {
    console.error(error);
    const content = error?.message || "Unable to update global ranks.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
}

async function handleMessage(message) {
  if (message.author.bot || message.guildId !== guildId) {
    return;
  }

  const parsedCommand = parseMessageCommand(message.content);
  if (!parsedCommand) {
    return;
  }

  const operation = messageCommandOperations[parsedCommand.command];

  try {
    const guildMember = message.member || (await fetchGuildMember(message.author.id));
    await upsertDiscordMember(guildMember);

    const updateResult = await applyPlayerRankOperation(
      message.author.id,
      operation,
      parsedCommand.rankText
    );
    const changedFields = changedFieldsFromUpdate(updateResult);
    await refreshDisplaysForFields(changedFields);

    await message.reply({
      content: formatUpdateMessage(message.author.id, updateResult),
      allowedMentions: {
        repliedUser: false,
        users: [message.author.id],
      },
    });
  } catch (error) {
    console.error(error);
    await message.reply({
      content: `<@${message.author.id}> ${error?.message || "Unable to update global rank."}`,
      allowedMentions: {
        repliedUser: false,
        users: [message.author.id],
      },
    });
  }
}

client.once("ready", async () => {
  try {
    await registerSlashCommands();
    console.log(`Logged in as ${client.user.tag}. Global rank commands registered.`);
  } catch (error) {
    console.error("Unable to register global rank slash commands.", error);
    process.exitCode = 1;
    client.destroy();
  }
});

client.on("interactionCreate", (interaction) => {
  void handleInteraction(interaction);
});

client.on("messageCreate", (message) => {
  void handleMessage(message);
});

client.login(token);
