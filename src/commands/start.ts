import { randomUUID } from "crypto";
import type { ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { StateManager } from "../state.js";
import { config } from "../config.js";
import { pinStatusMessage, removeStatusPin } from "../utils.js";

/**
 * 현재 채널에서 Claude 세션을 시작한다.
 * 이미 활성 세션이 있으면 현재 상태를 표시하고 종료.
 * force 옵션이 true이면 기존 세션을 제거하고 새로 시작한다.
 * 채널 이름을 주제로 사용하며, 상태 메시지를 고정한다.
 */
export async function handleStart(
  interaction: ChatInputCommandInteraction,
  state: StateManager,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const force = interaction.options.getBoolean("force") ?? false;
  const existing = state.getSessionByChannelId(interaction.channelId);
  if (existing) {
    if (!force) {
      await interaction.reply(
        `**이미 세션이 활성화되어 있습니다.**\n**주제:** ${existing.topicName}\n**Session:** \`${existing.sessionId.slice(0, 8)}\`\n**CWD:** \`${existing.projectPath}\`\n**Messages:** ${existing.messageCount}\n\n세션을 강제로 재시작하려면 \`/start force:True\`를 사용하세요.`,
      );
      return;
    }
    // force: 기존 세션 제거 후 새로 시작
    state.removeSession(interaction.channelId);
    await removeStatusPin(
      interaction.channel as TextChannel,
      interaction.client.user!.id,
    );
  }

  const channel = interaction.channel as TextChannel;
  const topicName = channel.name;
  const sessionId = randomUUID();
  const cwd = state.getCwd(interaction.channelId) || config.defaultCwd;

  const session = {
    sessionId,
    channelId: interaction.channelId,
    topicName,
    projectPath: cwd,
    createdAt: new Date().toISOString(),
    messageCount: 0,
    lastAlertPercent: 0,
  };

  state.addSession(session);

  await interaction.reply(
    `Claude 세션을 시작합니다.\n**주제:** ${topicName}\n메시지를 보내면 Claude와 대화할 수 있습니다.`,
  );

  await pinStatusMessage(channel, session, interaction.client.user!.id);
}
