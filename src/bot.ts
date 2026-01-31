import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  type Message,
  type TextChannel,
  type Guild,
} from "discord.js";
import { config } from "./config.js";
import { runClaude } from "./claude.js";
import { dispatchCommand, generateHelpText } from "./commands/index.js";
import { sendLongMessage } from "./channels/messageSender.js";
import { handleChoices } from "./interactions/reactionHandler.js";
import { getSessionUsage } from "./utils.js";
import type { StateManager } from "./state.js";
import type { SessionMapping } from "./types.js";

function logIO(direction: "IN" | "OUT", channel: string, author: string, content: string): void {
  const ts = new Date().toISOString();
  const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;
  console.log(`[${ts}] [${direction}] #${channel} @${author}: ${preview}`);
}

const ALERT_CHANNEL_NAME = "서버-알람";
const GUIDE_CHANNEL_NAME = "서버-안내";

const TOKEN_ALERT_THRESHOLDS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 100];

// Cached alert channel reference
let alertChannel: TextChannel | null = null;

export function createBot(state: StateManager): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });

  client.once("ready", async () => {
    console.log(`Logged in as ${client.user?.tag}`);

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      console.error(`Guild ${config.guildId} not found`);
      return;
    }

    await ensureSystemChannels(guild, client);
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (message.guild?.id !== config.guildId) return;

    if (
      config.allowedUserIds &&
      !config.allowedUserIds.includes(message.author.id)
    ) {
      return;
    }

    // Try command dispatch first
    if (message.content.startsWith("!")) {
      const handled = await dispatchCommand(message, state);
      if (handled) return;
    }

    // Check if message is in a session channel
    const session = state.getSessionByChannelId(message.channel.id);
    if (session) {
      // Block if over token limit (read from JSONL)
      if (config.sessionTokenLimit > 0) {
        const usage = await getSessionUsage(session.sessionId, session.projectPath);
        const total = usage.inputTokens + usage.outputTokens;
        if (total >= config.sessionTokenLimit) {
          await message.reply(
            `토큰 한도를 초과했습니다 (${total.toLocaleString()} / ${config.sessionTokenLimit.toLocaleString()}).`,
          );
          return;
        }
      }

      await handleSessionMessage(message, session, state);
    }
  });

  return client;
}

async function ensureSystemChannels(guild: Guild, client: Client): Promise<void> {
  await ensureAlertChannel(guild, client);
  await ensureGuideChannel(guild, client);
}

async function ensureAlertChannel(guild: Guild, client: Client): Promise<void> {
  let channel = guild.channels.cache.find(
    (ch) => ch.name === ALERT_CHANNEL_NAME && ch.type === ChannelType.GuildText,
  ) as TextChannel | undefined;

  if (!channel) {
    channel = await guild.channels.create({
      name: ALERT_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: "Claude Code Bot 알림 채널",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: client.user!.id,
          allow: [PermissionFlagsBits.SendMessages],
        },
      ],
    });
    console.log(`Created alert channel: #${ALERT_CHANNEL_NAME}`);
  }

  alertChannel = channel;
  await channel.send("**Claude For Discord Now Online**");
}

async function ensureGuideChannel(guild: Guild, client: Client): Promise<void> {
  let channel = guild.channels.cache.find(
    (ch) => ch.name === GUIDE_CHANNEL_NAME && ch.type === ChannelType.GuildText,
  ) as TextChannel | undefined;

  if (!channel) {
    channel = await guild.channels.create({
      name: GUIDE_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: "Claude Code Bot 사용 안내",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: client.user!.id,
          allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
        },
      ],
    });
    console.log(`Created guide channel: #${GUIDE_CHANNEL_NAME}`);
  }

  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size > 0) {
      await channel.bulkDelete(messages).catch(async () => {
        for (const msg of messages.values()) {
          await msg.delete().catch(() => {});
        }
      });
    }
  } catch (err) {
    console.error("Failed to clear guide channel:", err);
  }

  await channel.send(generateHelpText());
}

// --- Token alert helpers ---

async function checkTokenAlerts(
  session: SessionMapping,
  state: StateManager,
): Promise<void> {
  if (config.sessionTokenLimit <= 0) return;

  const usage = await getSessionUsage(session.sessionId, session.projectPath);
  const total = usage.inputTokens + usage.outputTokens;
  const percent = Math.floor((total / config.sessionTokenLimit) * 100);
  const prevPercent = session.lastAlertPercent ?? 0;

  for (const threshold of TOKEN_ALERT_THRESHOLDS) {
    if (percent >= threshold && prevPercent < threshold) {
      if (threshold >= 100) {
        sendAlertMessage(
          `**토큰 한도 초과** — #${session.topicName}\n` +
          `사용량: ${total.toLocaleString()} / ${config.sessionTokenLimit.toLocaleString()} (${percent}%)`,
        );
      } else {
        sendAlertMessage(
          `**토큰 사용량 ${threshold}%** — #${session.topicName}\n` +
          `사용량: ${total.toLocaleString()} / ${config.sessionTokenLimit.toLocaleString()}`,
        );
      }
    }
  }

  if (percent !== prevPercent) {
    state.updateSessionAlertPercent(session.channelId, percent);
  }
}

function sendAlertMessage(content: string): void {
  if (!alertChannel) return;
  alertChannel.send(content).catch((err) => {
    console.error("Failed to send alert:", err);
  });
}

// --- Session message handler ---

async function handleSessionMessage(
  message: Message,
  session: SessionMapping,
  state: StateManager,
  promptOverride?: string,
): Promise<void> {
  const channel = message.channel as TextChannel;
  const prompt = (promptOverride ?? message.content).trim();
  if (!prompt) return;

  logIO("IN", channel.name, message.author.tag, prompt);

  await channel.sendTyping();
  await message.react("⏳");

  try {
    const isResume = session.messageCount > 0;
    const result = await runClaude({
      prompt,
      sessionId: session.sessionId,
      isResume,
      cwd: session.projectPath,
    });

    state.updateSessionMessageCount(
      session.channelId,
      session.messageCount + 1,
    );

    await message.reactions.removeAll().catch(() => {});

    const response = result.success
      ? result.output
      : `Error: ${result.output}`;

    logIO("OUT", channel.name, "Claude", response);

    const sentMessages = await sendLongMessage(channel, response, {
      replyTo: message,
    });

    // Check token alerts after response (reads JSONL for absolute usage)
    await checkTokenAlerts(
      state.getSessionByChannelId(session.channelId)!,
      state,
    );

    // Check for choices in the response (reactions on last response message)
    if (result.success) {
      const lastMsg = sentMessages[sentMessages.length - 1];
      const choice = await handleChoices(response, lastMsg);
      if (choice) {
        await handleSessionMessage(
          message,
          state.getSessionByChannelId(session.channelId)!,
          state,
          choice,
        );
      }
    }
  } catch (err) {
    await message.reactions.removeAll().catch(() => {});
    await message.react("❌");
    console.error("Error handling session message:", err);
  }
}
