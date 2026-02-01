import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import type { ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { StateManager } from "../state.js";
import { validateCwdPath } from "../config.js";
import { pinStatusMessage } from "../utils.js";

/** ~ 를 홈 디렉토리로 치환하고 절대 경로로 변환한다. */
function resolvePath(raw: string): string {
  const expanded = raw.replace(/^~(?=$|\/|\\)/, os.homedir());
  return path.resolve(expanded);
}

/**
 * 작업 디렉토리를 확인하거나 변경한다.
 * - path 옵션이 없으면 현재 설정된 CWD를 표시
 * - path가 주어지면 존재 여부·화이트리스트 검증 후 저장
 * - 디렉토리가 없으면 생성 여부를 확인한 뒤 생성
 * - 활성 세션이 있으면 새 sessionId를 생성하여 세션을 갱신 (CLI 세션은 경로에 종속)
 */
export async function handleSetCwd(
  interaction: ChatInputCommandInteraction,
  state: StateManager,
): Promise<void> {
  const rawPath = interaction.options.getString("path")?.trim() ?? "";
  if (!rawPath) {
    const current = state.getCwd(interaction.channelId);
    await interaction.reply(
      current
        ? `Current working directory: \`${current}\``
        : "No working directory set. Usage: `/cwd path:/path/to/project`",
    );
    return;
  }

  const dirPath = resolvePath(rawPath);

  // 화이트/블랙리스트 검증을 먼저 수행
  const denied = validateCwdPath(dirPath);
  if (denied) {
    await interaction.reply(denied);
    return;
  }

  // reply가 확인 프롬프트로 이미 소비되었는지 추적
  let replied = false;

  if (fs.existsSync(dirPath)) {
    if (!fs.statSync(dirPath).isDirectory()) {
      await interaction.reply(`경로가 디렉토리가 아닙니다: \`${dirPath}\``);
      return;
    }
  } else {
    // 디렉토리가 없으면 생성 여부를 확인
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cwd_mkdir_yes")
        .setLabel("Yes")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("cwd_mkdir_no")
        .setLabel("No")
        .setStyle(ButtonStyle.Secondary),
    );

    const confirmMsg = await interaction.reply({
      content: `디렉토리가 존재하지 않습니다: \`${dirPath}\`\n생성하시겠습니까?`,
      components: [row],
    });
    replied = true;

    try {
      const btnInteraction = await confirmMsg.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 30_000,
      });

      if (btnInteraction.customId === "cwd_mkdir_no") {
        await btnInteraction.update({
          content: "작업 디렉토리 변경이 취소되었습니다.",
          components: [],
        });
        return;
      }

      // Yes 선택 — 디렉토리 생성
      fs.mkdirSync(dirPath, { recursive: true });
      await btnInteraction.update({
        content: `디렉토리를 생성했습니다: \`${dirPath}\``,
        components: [],
      });
    } catch {
      // 타임아웃
      await confirmMsg.edit({
        content: "시간이 초과되어 작업 디렉토리 변경이 취소되었습니다.",
        components: [],
      });
      return;
    }
  }

  state.setCwd(interaction.channelId, dirPath);

  const respond = replied
    ? (msg: string) => interaction.followUp(msg)
    : (msg: string) => interaction.reply(msg);

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
    await respond(
      `작업 디렉토리를 변경했습니다: \`${dirPath}\`\n새 세션이 시작됩니다 (\`${session.sessionId.slice(0, 8)}\`).`,
    );
  } else {
    await respond(`Working directory set to: \`${dirPath}\``);
  }
}
