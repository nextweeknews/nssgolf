"use strict";

require("dotenv").config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  "Run bot/discord-member-schema.sql, bot/player-settings-schema.sql, bot/global-rank-displays-schema.sql, and bot/event-signups-schema.sql in the Supabase SQL editor for this project.";

const leaderboardMessageAuthorName = "nssgolf.com Global Ranks";
const leaderboardMessageAvatarUrl =
  process.env.NSSGOLF_GLOBAL_RANKS_AVATAR_URL ||
  "https://www.nssgolf.com/logos/golf.png";
const recordsButtonTealColor = 0x2dd4bf;
const globalRankRecordsLink =
  "[View all Global Rank data at nssgolf.com](https://nssgolf.com/records.html?view=global-ranks)";

const rankDisplayConfigs = {
  current_global_rank: {
    commandName: "display_global_ranks",
    title: GLOBAL_RANK_FIELD_LABELS.current_global_rank,
    rankOrder: GLOBAL_RANKS_WITH_CS,
  },
  max_global_rank_no_cs: {
    commandName: "display_global_max_nocs",
    title: GLOBAL_RANK_FIELD_LABELS.max_global_rank_no_cs,
    rankOrder: GLOBAL_RANKS_NO_CS,
  },
  max_global_rank_cs: {
    commandName: "display_global_max_cs",
    title: "Max. Rank (Cloud Saves)",
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
            .setDescription("Rank value, for example S9, ∞3, inf3, or remove.")
            .setRequired(true)
        );
    }
  );

  const signupCommands = [
    new SlashCommandBuilder()
      .setName("signup_create")
      .setDescription("Create a signup event.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((option) =>
        option
          .setName("event_name")
          .setDescription("The event name.")
          .setRequired(true)
      )
      .addRoleOption((option) =>
        option
          .setName("required_role")
          .setDescription("Optional role required to sign up.")
      )
      .addIntegerOption((option) =>
        option
          .setName("deadline")
          .setDescription("Optional signup deadline as a Unix timestamp in seconds.")
          .setMinValue(1)
      ),
    new SlashCommandBuilder()
      .setName("signup_display")
      .setDescription("Post a signup display for an event.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((option) =>
        option
          .setName("event_name")
          .setDescription("The event name.")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("signup_delete")
      .setDescription("Delete a signup event and its signups.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((option) =>
        option
          .setName("event_name")
          .setDescription("The event name.")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("signup_manage")
      .setDescription("Update signup event settings.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((option) =>
        option
          .setName("event_name")
          .setDescription("The current event name.")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("new_event_name")
          .setDescription("Optional new event name.")
      )
      .addRoleOption((option) =>
        option
          .setName("required_role")
          .setDescription("Optional new role required to sign up.")
      )
      .addBooleanOption((option) =>
        option
          .setName("clear_required_role")
          .setDescription("Remove the required signup role.")
      )
      .addIntegerOption((option) =>
        option
          .setName("deadline")
          .setDescription("Optional new signup deadline as a Unix timestamp in seconds.")
          .setMinValue(1)
      )
      .addBooleanOption((option) =>
        option
          .setName("clear_deadline")
          .setDescription("Remove the signup deadline.")
      ),
  ];

  return [...displayCommands, ...setCommands, ...signupCommands].map((command) => command.toJSON());
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

function normalizeEventName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) {
    throw new Error("Include an event name.");
  }

  if (name.length > 100) {
    throw new Error("Event names must be 100 characters or fewer.");
  }

  return name;
}

function eventNameKey(value) {
  return normalizeEventName(value).toLowerCase();
}

function deadlineAtFromUnix(unixTimestamp) {
  if (unixTimestamp == null) {
    return null;
  }

  if (!Number.isSafeInteger(unixTimestamp) || unixTimestamp <= 0) {
    throw new Error("Deadline must be a positive Unix timestamp in seconds.");
  }

  if (unixTimestamp > 9999999999) {
    throw new Error("Deadline should be a Unix timestamp in seconds, not milliseconds.");
  }

  const deadline = new Date(unixTimestamp * 1000);
  if (Number.isNaN(deadline.getTime())) {
    throw new Error("Deadline must be a valid Unix timestamp in seconds.");
  }

  if (deadline.getTime() <= Date.now()) {
    throw new Error("Deadline must be in the future.");
  }

  return deadline.toISOString();
}

function unixTimestampFromIso(value) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : Math.floor(time / 1000);
}

function signupDeadlineHasPassed(event) {
  const unixTimestamp = unixTimestampFromIso(event?.deadline_at);
  return unixTimestamp != null && unixTimestamp <= Math.floor(Date.now() / 1000);
}

function memberHasRole(member, roleId) {
  const cleanRoleId = normalizeDiscordId(roleId);
  if (!cleanRoleId) {
    return true;
  }

  if (member?.roles?.cache?.has(cleanRoleId)) {
    return true;
  }

  return Array.isArray(member?.roles) && member.roles.includes(cleanRoleId);
}

function formatRequiredRole(roleId) {
  const cleanRoleId = normalizeDiscordId(roleId);
  return cleanRoleId ? `<@&${cleanRoleId}>` : "no required role";
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

async function loadSignupEventByName(name) {
  const { data, error } = await supabase
    .from("events")
    .select("id,guild_id,name,required_role_id,deadline_at,created_by_discord_user_id,created_at,updated_at")
    .eq("guild_id", guildId)
    .eq("name_key", eventNameKey(name))
    .maybeSingle();

  if (error) {
    throwSupabaseError("Signup event lookup failed", error);
  }

  return data || null;
}

async function loadSignupEventById(eventId) {
  const { data, error } = await supabase
    .from("events")
    .select("id,guild_id,name,required_role_id,deadline_at,created_by_discord_user_id,created_at,updated_at")
    .eq("guild_id", guildId)
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throwSupabaseError("Signup event lookup failed", error);
  }

  return data || null;
}

async function createSignupEvent({ name, requiredRoleId, deadlineAt, createdByDiscordUserId }) {
  const { data, error } = await supabase
    .from("events")
    .insert({
      guild_id: guildId,
      name,
      required_role_id: requiredRoleId || null,
      deadline_at: deadlineAt,
      created_by_discord_user_id: createdByDiscordUserId,
    })
    .select("id,guild_id,name,required_role_id,deadline_at,created_by_discord_user_id,created_at,updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`A signup event named "${name}" already exists.`);
    }

    throwSupabaseError("Signup event creation failed", error);
  }

  return data;
}

async function updateSignupEvent(event, updates) {
  const { data, error } = await supabase
    .from("events")
    .update(updates)
    .eq("guild_id", guildId)
    .eq("id", event.id)
    .select("id,guild_id,name,required_role_id,deadline_at,created_by_discord_user_id,created_at,updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`A signup event named "${updates.name}" already exists.`);
    }

    throwSupabaseError("Signup event update failed", error);
  }

  return data;
}

async function deleteSignupEvent(event) {
  const { error } = await supabase
    .from("events")
    .delete()
    .eq("guild_id", guildId)
    .eq("id", event.id);

  if (error) {
    throwSupabaseError("Signup event deletion failed", error);
  }
}

async function loadSignupRows(eventId) {
  const { data, error } = await supabase
    .from("event_signups")
    .select("event_id,event_name,discord_user_id,username,display_name,signed_up_at")
    .eq("event_id", eventId)
    .order("signed_up_at", { ascending: true });

  if (error) {
    throwSupabaseError("Signup rows lookup failed", error);
  }

  return data || [];
}

async function loadSignupRow(eventId, discordUserId) {
  const { data, error } = await supabase
    .from("event_signups")
    .select("event_id,discord_user_id")
    .eq("event_id", eventId)
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (error) {
    throwSupabaseError("Signup row lookup failed", error);
  }

  return data || null;
}

async function insertSignupRow(event, guildMember) {
  const { error } = await supabase
    .from("event_signups")
    .insert({
      event_id: event.id,
      event_name: event.name,
      guild_id: guildId,
      discord_user_id: guildMember.user.id,
      username: guildMember.user.username,
      display_name: guildMember.displayName || guildMember.user.username,
    });

  if (error) {
    if (error.code === "23505") {
      throw new Error("You're already signed up for this event.");
    }

    throwSupabaseError("Signup creation failed", error);
  }
}

async function deleteSignupRow(eventId, discordUserId) {
  const { data, error } = await supabase
    .from("event_signups")
    .delete()
    .eq("event_id", eventId)
    .eq("discord_user_id", discordUserId)
    .select("event_id,discord_user_id");

  if (error) {
    throwSupabaseError("Signup removal failed", error);
  }

  return (data || []).length > 0;
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
    .map((change) =>
      change.removed
        ? `${change.label} removed`
        : `${change.label} updated to **${change.rank}**`
    )
    .join("; ");

  return `<@${discordUserId}> ${changeText}`;
}

function formatMessageCommandUpdate(discordUserId, operation, updateResult) {
  const settings = updateResult?.settings || {};
  const config = {
    rank_no_cs: {
      label: "Global rank (no CS)",
      field: "current_global_rank",
    },
    rank_cs: {
      label: "Global rank (CS)",
      field: "current_global_rank",
    },
    max_no_cs: {
      label: "Global max rank (no CS)",
      field: "max_global_rank_no_cs",
    },
    max_cs: {
      label: "Global max rank (CS)",
      field: "max_global_rank_cs",
    },
  }[operation];

  const rank = settings[config?.field] || updateResult?.changes?.[0]?.rank || "";
  const removed = updateResult?.changes?.some(
    (change) => change.field === config?.field && change.removed
  );

  if (config && removed) {
    return `<@${discordUserId}> removed ${config.label}`;
  }

  if (!config || !rank) {
    return formatUpdateMessage(discordUserId, updateResult);
  }

  return `<@${discordUserId}> updated ${config.label} to **${rank}**`;
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
    "Include a rank value, like S9 or inf3, or type remove. For max commands, you can also set your current rank first."
  );
}

async function applyPlayerRankOperation(discordUserId, operation, rankText) {
  const settings = await ensureSettingsRow(discordUserId);
  const rankValue = await rankForOperation(settings, operation, rankText);
  const updateResult = applyRankUpdate(settings, operation, rankValue);
  await saveSettings(discordUserId, updateResult.settings);
  return updateResult;
}

async function loadHiddenRankDiscordIds(rankKey) {
  const { data, error } = await supabase
    .from("player_global_rank_moderation")
    .select("discord_user_id")
    .eq("rank_key", rankKey);

  if (error) {
    throwSupabaseError("Global rank moderation lookup failed", error);
  }

  return new Set(
    (data || [])
      .map((row) => normalizeDiscordId(row.discord_user_id))
      .filter(Boolean)
  );
}

async function loadRankRows(rankKey, rankOrder) {
  const [hiddenDiscordIds, settingsResponse] = await Promise.all([
    loadHiddenRankDiscordIds(rankKey),
    supabase
      .from("player_settings")
      .select(`discord_user_id,${rankKey}`)
      .not(rankKey, "is", null),
  ]);

  const { data: settingsRows, error: settingsError } = settingsResponse;
  if (settingsError) {
    throwSupabaseError("Global rank settings lookup failed", settingsError);
  }

  const cleanSettingsRows = (settingsRows || [])
    .map((row) => ({
      discord_user_id: normalizeDiscordId(row.discord_user_id),
      rank: normalizeRankInput(row[rankKey], rankOrder),
    }))
    .filter((row) => row.discord_user_id && row.rank && !hiddenDiscordIds.has(row.discord_user_id));

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
    const nextChunk = currentChunk ? `${currentChunk}\n${section}` : section;
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

function appendGlobalRanksLink(description) {
  return `${description}\n\n${globalRankRecordsLink}`;
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

    return `**${rank}**\n${names.join("\n")}`;
  });

  const descriptionChunks = chunkRankSections(sections);
  return descriptionChunks.slice(0, 10).map((description, index) => {
    const title =
      descriptionChunks.length > 1
        ? `${config.title} (${index + 1}/${Math.min(descriptionChunks.length, 10)})`
        : config.title;

    return new EmbedBuilder()
      .setTitle(title)
      .setColor(recordsButtonTealColor)
      .setDescription(appendGlobalRanksLink(description))
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

async function deleteDisplayMessage(row) {
  const webhookClient = webhookClientForRow(row);
  await webhookClient.deleteMessage(row.message_id);
}

async function ensureWebhook(channel) {
  if (!channel || typeof channel.createWebhook !== "function") {
    throw new Error("Use this command in a server text channel where the bot can manage webhooks.");
  }

  assertDisplayPermissions(channel);

  const webhookName = leaderboardMessageAuthorName;
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
    avatar: leaderboardMessageAvatarUrl,
    reason: "Create NSS Golf global rank display messages.",
  });
}

async function createOrUpdateDisplay(channel, rankKey, createdByDiscordUserId) {
  const embeds = await buildRankEmbeds(rankKey);
  const existingRow = await loadDisplayRow(channel.id, rankKey);

  if (existingRow) {
    try {
      await deleteDisplayMessage(existingRow);
    } catch (error) {
      console.warn(
        `Unable to delete existing ${rankKey} display ${existingRow.message_id}; creating a replacement.`,
        error
      );
    }

    await deleteDisplayRow(existingRow);
  }

  const webhook = await ensureWebhook(channel);
  if (!webhook?.id || !webhook?.token) {
    throw new Error("Unable to create a usable webhook for this channel.");
  }

  const message = await webhook.send({
    username: leaderboardMessageAuthorName,
    avatarURL: leaderboardMessageAvatarUrl,
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

  return { action: existingRow ? "recreated" : "created", messageId: message.id };
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

const displayRefreshTimers = new Map();

function scheduleDisplayRefreshForField(rankKey) {
  if (!rankDisplayConfigs[rankKey] || displayRefreshTimers.has(rankKey)) {
    return;
  }

  const timer = setTimeout(() => {
    displayRefreshTimers.delete(rankKey);
    void refreshDisplaysForFields([rankKey]).catch((error) => {
      console.warn(`Unable to refresh ${rankKey} display after moderation change.`, error);
    });
  }, 300);

  displayRefreshTimers.set(rankKey, timer);
}

function rankKeyFromModerationPayload(payload) {
  return payload?.new?.rank_key || payload?.old?.rank_key || "";
}

function subscribeGlobalRankModerationChanges() {
  return supabase
    .channel("global-rank-moderation-changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "player_global_rank_moderation",
      },
      (payload) => {
        const rankKey = rankKeyFromModerationPayload(payload);
        if (!rankKey) {
          return;
        }

        scheduleDisplayRefreshForField(rankKey);
      }
    )
    .subscribe((status, error) => {
      if (error) {
        console.warn("Global rank moderation realtime subscription error.", error);
        return;
      }

      console.log(`Global rank moderation realtime subscription status: ${status}`);
    });
}

function buildSignupEmbed(event, signupRows) {
  const lines = [`**Sign-ups for ${escapedDisplayName(event.name)}:**`];
  const deadlineUnix = unixTimestampFromIso(event.deadline_at);
  if (deadlineUnix != null) {
    lines.push(`<t:${deadlineUnix}:R>`);
  }

  const signupLines = (signupRows || []).map((row) =>
    escapedDisplayName(row.display_name || row.username || row.discord_user_id)
  );

  if (signupLines.length) {
    lines.push(signupLines.join("\n"));
  }

  return new EmbedBuilder().setDescription(lines.join("\n"));
}

function signupActionRows(event) {
  const disabled = signupDeadlineHasPassed(event);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`signup:join:${event.id}`)
        .setLabel("Sign up")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`signup:leave:${event.id}`)
        .setLabel("Remove me")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    ),
  ];
}

async function signupMessagePayload(event) {
  const signupRows = await loadSignupRows(event.id);
  return {
    embeds: [buildSignupEmbed(event, signupRows)],
    components: signupActionRows(event),
    allowedMentions: { parse: [] },
  };
}

function signupButtonParts(customId) {
  const match = String(customId || "").match(/^signup:(join|leave):([0-9a-f-]{36})$/i);
  if (!match) {
    return null;
  }

  return {
    action: match[1],
    eventId: match[2],
  };
}

async function handleSignupCreateInteraction(interaction) {
  if (!memberIsRankAdmin(interaction.member)) {
    await interaction.reply({
      content: "Only server admins can create signup events.",
      ephemeral: true,
    });
    return;
  }

  const name = normalizeEventName(interaction.options.getString("event_name", true));
  const requiredRole = interaction.options.getRole("required_role");
  const deadlineAt = deadlineAtFromUnix(interaction.options.getInteger("deadline"));

  await interaction.deferReply({ ephemeral: true });
  const event = await createSignupEvent({
    name,
    requiredRoleId: requiredRole?.id || null,
    deadlineAt,
    createdByDiscordUserId: interaction.user.id,
  });

  const details = [
    `Created signup event **${escapedDisplayName(event.name)}**.`,
    event.required_role_id ? `Required role: ${formatRequiredRole(event.required_role_id)}.` : null,
    event.deadline_at ? `Deadline: <t:${unixTimestampFromIso(event.deadline_at)}:F>.` : null,
  ].filter(Boolean);

  await interaction.editReply({
    content: details.join("\n"),
    allowedMentions: { parse: [] },
  });
}

async function handleSignupDisplayInteraction(interaction) {
  if (!memberIsRankAdmin(interaction.member)) {
    await interaction.reply({
      content: "Only server admins can post signup displays.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  const event = await loadSignupEventByName(interaction.options.getString("event_name", true));
  if (!event) {
    await interaction.editReply("No signup event with that name exists.");
    return;
  }

  await interaction.editReply(await signupMessagePayload(event));
}

async function handleSignupDeleteInteraction(interaction) {
  if (!memberIsRankAdmin(interaction.member)) {
    await interaction.reply({
      content: "Only server admins can delete signup events.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const event = await loadSignupEventByName(interaction.options.getString("event_name", true));
  if (!event) {
    await interaction.editReply("No signup event with that name exists.");
    return;
  }

  await deleteSignupEvent(event);
  await interaction.editReply({
    content: `Deleted signup event **${escapedDisplayName(event.name)}** and its signups.`,
    allowedMentions: { parse: [] },
  });
}

async function handleSignupManageInteraction(interaction) {
  if (!memberIsRankAdmin(interaction.member)) {
    await interaction.reply({
      content: "Only server admins can manage signup events.",
      ephemeral: true,
    });
    return;
  }

  const clearRequiredRole = interaction.options.getBoolean("clear_required_role") === true;
  const clearDeadline = interaction.options.getBoolean("clear_deadline") === true;
  const requiredRole = interaction.options.getRole("required_role");
  const deadline = interaction.options.getInteger("deadline");
  if (clearRequiredRole && requiredRole) {
    await interaction.reply({
      content: "Choose either required_role or clear_required_role, not both.",
      ephemeral: true,
    });
    return;
  }

  if (clearDeadline && deadline != null) {
    await interaction.reply({
      content: "Choose either deadline or clear_deadline, not both.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const event = await loadSignupEventByName(interaction.options.getString("event_name", true));
  if (!event) {
    await interaction.editReply("No signup event with that name exists.");
    return;
  }

  const updates = {};
  const newEventName = interaction.options.getString("new_event_name");
  if (newEventName != null) {
    updates.name = normalizeEventName(newEventName);
  }

  if (requiredRole) {
    updates.required_role_id = requiredRole.id;
  } else if (clearRequiredRole) {
    updates.required_role_id = null;
  }

  if (deadline != null) {
    updates.deadline_at = deadlineAtFromUnix(deadline);
  } else if (clearDeadline) {
    updates.deadline_at = null;
  }

  if (!Object.keys(updates).length) {
    await interaction.editReply("No signup event settings were changed.");
    return;
  }

  const updatedEvent = await updateSignupEvent(event, updates);
  const details = [
    `Updated signup event **${escapedDisplayName(updatedEvent.name)}**.`,
    `Required role: ${formatRequiredRole(updatedEvent.required_role_id)}.`,
    updatedEvent.deadline_at
      ? `Deadline: <t:${unixTimestampFromIso(updatedEvent.deadline_at)}:F>.`
      : "Deadline: none.",
  ];

  await interaction.editReply({
    content: details.join("\n"),
    allowedMentions: { parse: [] },
  });
}

async function refreshSignupDisplayMessage(interaction, event) {
  try {
    await interaction.message.edit(await signupMessagePayload(event));
  } catch (error) {
    console.warn(`Unable to refresh signup display for ${event.id}.`, error);
  }
}

async function handleSignupButtonInteraction(interaction) {
  const button = signupButtonParts(interaction.customId);
  if (!button || interaction.guildId !== guildId) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const event = await loadSignupEventById(button.eventId);
  if (!event) {
    await interaction.editReply("This signup event no longer exists.");
    return;
  }

  if (signupDeadlineHasPassed(event)) {
    await interaction.editReply("The signup deadline has passed, so changes are closed.");
    return;
  }

  const guildMember = await fetchGuildMember(interaction.user.id);
  await upsertDiscordMember(guildMember);

  if (button.action === "join") {
    if (event.required_role_id && !memberHasRole(guildMember, event.required_role_id)) {
      await interaction.editReply({
        content: `You need ${formatRequiredRole(event.required_role_id)} to sign up for this event.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (await loadSignupRow(event.id, interaction.user.id)) {
      await interaction.editReply("You're already signed up for this event.");
      return;
    }

    await insertSignupRow(event, guildMember);
    await refreshSignupDisplayMessage(interaction, event);
    await interaction.editReply("You're signed up.");
    return;
  }

  const removed = await deleteSignupRow(event.id, interaction.user.id);
  if (!removed) {
    await interaction.editReply("You're not signed up for this event.");
    return;
  }

  await refreshSignupDisplayMessage(interaction, event);
  await interaction.editReply("Removed your signup.");
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
  if (interaction.guildId !== guildId) {
    return;
  }

  try {
    if (interaction.isButton()) {
      await handleSignupButtonInteraction(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

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
      return;
    }

    if (interaction.commandName === "signup_create") {
      await handleSignupCreateInteraction(interaction);
      return;
    }

    if (interaction.commandName === "signup_display") {
      await handleSignupDisplayInteraction(interaction);
      return;
    }

    if (interaction.commandName === "signup_delete") {
      await handleSignupDeleteInteraction(interaction);
      return;
    }

    if (interaction.commandName === "signup_manage") {
      await handleSignupManageInteraction(interaction);
    }
  } catch (error) {
    console.error(error);
    const content = error?.message || "Unable to handle interaction.";
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

    await message.channel.send({
      content: formatMessageCommandUpdate(message.author.id, operation, updateResult),
      allowedMentions: {
        users: [message.author.id],
      },
    });

    await refreshDisplaysForFields(changedFields);
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
    subscribeGlobalRankModerationChanges();
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
