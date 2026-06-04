require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const supabaseUrl = process.env.NSSGOLF_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRoleKey =
  process.env.NSSGOLF_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!token || !guildId) {
  console.error(
    "Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID. Add them to .env before scanning."
  );
  process.exit(1);
}

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error(
    "Missing NSSGOLF_SUPABASE_URL or NSSGOLF_SUPABASE_SERVICE_ROLE_KEY. The Discord scan stores data in Supabase."
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

const outputDir = path.join(__dirname, "output");
const outputPath = path.join(outputDir, "members.json");
const chunkSize = 500;
const missingTableMessage =
  "Run bot/discord-member-schema.sql in the Supabase SQL editor for the project used by NSSGOLF_SUPABASE_URL, then rerun this workflow.";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function chunkRows(rows, size = chunkSize) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function roleSummary(member, guild) {
  return member.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
      color: role.color,
      isManaged: role.managed,
      isMentionable: role.mentionable,
      isHoisted: role.hoist,
    }));
}

function memberSummary(member, guild) {
  return {
    id: member.user.id,
    username: member.user.username,
    globalName: member.user.globalName,
    discriminator: member.user.discriminator,
    bot: member.user.bot,
    displayName: member.displayName,
    nickname: member.nickname,
    avatarUrl: member.user.displayAvatarURL({ size: 256, extension: "png" }),
    serverAvatarUrl: member.displayAvatarURL({ size: 256, extension: "png" }),
    roles: roleSummary(member, guild),
    joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
  };
}

async function assertSafeBotPermissions(guild) {
  const botMember = await guild.members.fetchMe();
  const permissions = botMember.permissions;
  const unsafePermissions = [];

  if (permissions.has(PermissionFlagsBits.Administrator)) {
    unsafePermissions.push("Administrator");
  }

  if (permissions.has(PermissionFlagsBits.ManageRoles)) {
    unsafePermissions.push("Manage Roles");
  }

  if (unsafePermissions.length > 0) {
    throw new Error(
      `Refusing to scan because the bot has unsafe server permissions: ${unsafePermissions.join(", ")}. ` +
        "Remove these permissions before running the scheduled scanner."
    );
  }
}

async function upsertInChunks(tableName, rows, options) {
  if (rows.length === 0) {
    return;
  }

  for (const chunk of chunkRows(rows)) {
    const { error } = await supabase.from(tableName).upsert(chunk, options);
    if (error) {
      throw new Error(`${tableName} upsert failed: ${error.message}`);
    }
  }
}

function isMissingSupabaseTableError(error) {
  return /schema cache|could not find the table|does not exist/i.test(
    error?.message || ""
  );
}

function throwSupabaseError(context, error) {
  if (isMissingSupabaseTableError(error)) {
    throw new Error(`${context}: ${error.message}. ${missingTableMessage}`);
  }

  throw new Error(`${context}: ${error.message}`);
}

async function insertInChunks(tableName, rows) {
  if (rows.length === 0) {
    return;
  }

  for (const chunk of chunkRows(rows)) {
    const { error } = await supabase.from(tableName).insert(chunk);
    if (error) {
      throw new Error(`${tableName} insert failed: ${error.message}`);
    }
  }
}

async function syncMembersToSupabase(guild, members, scannedAt) {
  const roleRows = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .map((role) => ({
      guild_id: guild.id,
      role_id: role.id,
      name: role.name,
      position: role.position,
      color: role.color,
      is_managed: role.managed,
      is_mentionable: role.mentionable,
      is_hoisted: role.hoist,
      is_current_role: true,
      last_scanned_at: scannedAt,
    }));

  const memberRows = members.map((member) => ({
    guild_id: guild.id,
    discord_user_id: member.id,
    username: member.username,
    global_name: member.globalName,
    discriminator: member.discriminator,
    is_bot: member.bot,
    display_name: member.displayName,
    nickname: member.nickname,
    avatar_url: member.avatarUrl,
    server_avatar_url: member.serverAvatarUrl,
    joined_at: member.joinedAt,
    is_current_member: true,
    last_scanned_at: scannedAt,
  }));

  const memberRoleRows = [];

  for (const member of members) {
    for (const role of member.roles) {
      memberRoleRows.push({
        guild_id: guild.id,
        discord_user_id: member.id,
        role_id: role.id,
        scanned_at: scannedAt,
      });
    }
  }

  const { error: markStaleError } = await supabase
    .from("discord_guild_members")
    .update({ is_current_member: false, last_scanned_at: scannedAt })
    .eq("guild_id", guild.id);
  if (markStaleError) {
    throwSupabaseError("member stale-mark failed", markStaleError);
  }

  const { error: markStaleRolesError } = await supabase
    .from("discord_roles")
    .update({ is_current_role: false, last_scanned_at: scannedAt })
    .eq("guild_id", guild.id);
  if (markStaleRolesError) {
    throwSupabaseError("role stale-mark failed", markStaleRolesError);
  }

  await upsertInChunks("discord_guild_members", memberRows, {
    onConflict: "guild_id,discord_user_id",
  });
  await upsertInChunks("discord_roles", roleRows, {
    onConflict: "guild_id,role_id",
  });

  const { error: deleteRolesError } = await supabase
    .from("discord_member_roles")
    .delete()
    .eq("guild_id", guild.id);
  if (deleteRolesError) {
    throwSupabaseError("member role cleanup failed", deleteRolesError);
  }

  await insertInChunks("discord_member_roles", memberRoleRows);

  return {
    memberCount: memberRows.length,
    roleCount: roleRows.length,
    memberRoleCount: memberRoleRows.length,
  };
}

client.once("ready", async () => {
  try {
    const scannedAt = new Date().toISOString();
    console.log(`Logged in as ${client.user.tag}. Fetching guild ${guildId}...`);

    const guild = await client.guilds.fetch(guildId);
    await assertSafeBotPermissions(guild);
    await guild.roles.fetch();

    console.log("Fetching all guild members. This requires Server Members Intent.");
    const memberCollection = await guild.members.fetch();
    const members = [...memberCollection.values()]
      .map((member) => memberSummary(member, guild))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(members, null, 2)}\n`);

    const syncStats = await syncMembersToSupabase(guild, members, scannedAt);
    console.log(
      `Synced ${syncStats.memberCount} members, ${syncStats.roleCount} roles, ` +
        `${syncStats.memberRoleCount} member-role links to Supabase.`
    );
    console.log(`Wrote local audit export to ${outputPath}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(token);
