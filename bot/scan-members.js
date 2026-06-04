require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
} = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const reportChannelId = process.env.DISCORD_SCAN_REPORT_CHANNEL_ID;

if (!token || !guildId) {
  console.error(
    "Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID. Add them to .env before scanning."
  );
  process.exit(1);
}

const outputDir = path.join(__dirname, "output");
const outputPath = path.join(outputDir, "members.json");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

function roleSummary(member, guild) {
  return member.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
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

async function sendReport(guild, members, filePath) {
  if (!reportChannelId) {
    return;
  }

  const channel = await guild.channels.fetch(reportChannelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(
      "DISCORD_SCAN_REPORT_CHANNEL_ID does not point to a text-based channel."
    );
  }

  const attachment = new AttachmentBuilder(filePath, {
    name: "nssgolf-discord-members.json",
  });

  await channel.send({
    content: `NSS Golf member scan complete: ${members.length} members exported.`,
    files: [attachment],
  });
}

client.once("ready", async () => {
  try {
    console.log(`Logged in as ${client.user.tag}. Fetching guild ${guildId}...`);

    const guild = await client.guilds.fetch(guildId);
    await guild.roles.fetch();

    console.log("Fetching all guild members. This requires Server Members Intent.");
    const memberCollection = await guild.members.fetch();
    const members = [...memberCollection.values()]
      .map((member) => memberSummary(member, guild))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(members, null, 2)}\n`);

    console.log(`Exported ${members.length} members to ${outputPath}`);
    await sendReport(guild, members, outputPath);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(token);
