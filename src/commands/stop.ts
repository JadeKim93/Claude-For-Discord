import type { Message, TextChannel } from "discord.js";
import type { StateManager } from "../state.js";
import { removeStatusPin } from "../utils.js";

export async function handleStop(
  message: Message,
  _args: string,
  state: StateManager,
): Promise<void> {
  const removed = state.removeSession(message.channel.id);
  if (removed) {
    await removeStatusPin(
      message.channel as TextChannel,
      message.client.user!.id,
    );
    await message.reply(
      `세션을 종료했습니다.\n**주제:** ${removed.topicName}\n**Messages:** ${removed.messageCount}`,
    );
  } else {
    await message.reply("이 채널에 활성 세션이 없습니다.");
  }
}
