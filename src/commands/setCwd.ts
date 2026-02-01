import fs from "fs";
import { randomUUID } from "crypto";
import type { ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { StateManager } from "../state.js";
import { validateCwdPath } from "../config.js";
import { pinStatusMessage } from "../utils.js";

/**
 * 작업 디렉토리를 확인하거나 변경한다.
 * - path 옵션이 없으면 현재 설정된 CWD를 표시
 * - path가 주어지면 존재 여부·화이트리스트 검증 후 저장
 * - 활성 세션이 있으면 새 sessionId를 생성하여 세션을 갱신 (CLI 세션은 경로에 종속)
 */
export async function handleSetCwd(
  interaction: ChatInputCommandInteraction,
  state: StateManager,
): Promise<void> {
  const dirPath = interaction.options.getString("path")?.trim() ?? "";
  if (!dirPath) {
    const current = state.getCwd(interaction.guild?.id || "");
    await interaction.reply(
      current
        ? `Current working directory: \`${current}\``
        : "No working directory set. Usage: `/cwd path:/path/to/project`",
    );
    return;
  }

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    await interaction.reply(`Directory not found: \`${dirPath}\``);
    return;
  }

  const denied = validateCwdPath(dirPath);
  if (denied) {
    await interaction.reply(denied);
    return;
  }

  state.setCwd(interaction.guild?.id || "", dirPath);

  // If an active session exists, create a new session at the new path
  // (Claude CLI sessions are tied to project paths, so we need a fresh session)
  const session = state.getSessionByChannelId(interaction.channelId);
  if (session) {
    session.projectPath = dirPath;
    session.sessionId = randomUUID();
    session.messageCount = 0;
    session.lastAlertPercent = 0;
    state.addSession(session); // triggers save
    const channel = interaction.channel as TextChannel;
    await pinStatusMessage(channel, session, interaction.client.user!.id);
    await interaction.reply(
      `작업 디렉토리를 변경했습니다: \`${dirPath}\`\n새 세션이 시작됩니다 (\`${session.sessionId.slice(0, 8)}\`).`,
    );
  } else {
    await interaction.reply(`Working directory set to: \`${dirPath}\``);
  }
}
