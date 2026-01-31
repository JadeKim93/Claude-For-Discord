import { randomUUID } from "crypto";
import type { Message, TextChannel } from "discord.js";
import type { StateManager } from "../state.js";
import { config } from "../config.js";
import { pinStatusMessage } from "../utils.js";

export async function handleStart(
  message: Message,
  _args: string,
  state: StateManager,
): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const existing = state.getSessionByChannelId(message.channel.id);
  if (existing) {
    await message.reply(
      `**이미 세션이 활성화되어 있습니다.**\n**주제:** ${existing.topicName}\n**Session:** \`${existing.sessionId.slice(0, 8)}\`\n**CWD:** \`${existing.projectPath}\`\n**Messages:** ${existing.messageCount}`,
    );
    return;
  }

  const channel = message.channel as TextChannel;
  const topicName = channel.name;
  const sessionId = randomUUID();
  const cwd = state.getCwd(guild.id) || config.defaultCwd;

  const session = {
    sessionId,
    channelId: message.channel.id,
    topicName,
    projectPath: cwd,
    createdAt: new Date().toISOString(),
    messageCount: 0,
    lastAlertPercent: 0,
  };

  state.addSession(session);

  await message.reply(
    `Claude 세션을 시작합니다.\n**주제:** ${topicName}\n메시지를 보내면 Claude와 대화할 수 있습니다.`,
  );

  await pinStatusMessage(channel, session, message.client.user!.id);
}
