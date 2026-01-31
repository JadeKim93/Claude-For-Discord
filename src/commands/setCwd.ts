import fs from "fs";
import type { Message, TextChannel } from "discord.js";
import type { StateManager } from "../state.js";
import { validateCwdPath } from "../config.js";
import { pinStatusMessage } from "../utils.js";

export async function handleSetCwd(
  message: Message,
  args: string,
  state: StateManager,
): Promise<void> {
  const dirPath = args.trim();
  if (!dirPath) {
    const current = state.getCwd(message.guild?.id || "");
    await message.reply(
      current
        ? `Current working directory: \`${current}\``
        : "No working directory set. Usage: `!cwd /path/to/project`",
    );
    return;
  }

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    await message.reply(`Directory not found: \`${dirPath}\``);
    return;
  }

  const denied = validateCwdPath(dirPath);
  if (denied) {
    await message.reply(denied);
    return;
  }

  state.setCwd(message.guild?.id || "", dirPath);
  await message.reply(`Working directory set to: \`${dirPath}\``);

  // Update the active session's projectPath and re-pin status
  const session = state.getSessionByChannelId(message.channel.id);
  if (session) {
    session.projectPath = dirPath;
    state.addSession(session); // triggers save
    const channel = message.channel as TextChannel;
    await pinStatusMessage(channel, session, message.client.user!.id);
  }
}
