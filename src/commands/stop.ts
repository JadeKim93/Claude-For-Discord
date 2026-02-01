import type { ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { StateManager } from "../state.js";
import { removeStatusPin } from "../utils.js";

/** 현재 채널의 세션을 종료하고 고정 메시지를 삭제한다. */
export async function handleStop(
  interaction: ChatInputCommandInteraction,
  state: StateManager,
): Promise<void> {
  const removed = state.removeSession(interaction.channelId);
  if (removed) {
    await removeStatusPin(
      interaction.channel as TextChannel,
      interaction.client.user!.id,
    );
    await interaction.reply(
      `세션을 종료했습니다.\n**주제:** ${removed.topicName}\n**Messages:** ${removed.messageCount}`,
    );
  } else {
    await interaction.reply("이 채널에 활성 세션이 없습니다.");
  }
}
