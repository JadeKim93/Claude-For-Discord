import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from "discord.js";
import type { StateManager } from "../state.js";
import { handleStart } from "./start.js";
import { handleStop } from "./stop.js";
import { handleSetCwd } from "./setCwd.js";

export type CommandHandler = (
  interaction: ChatInputCommandInteraction,
  state: StateManager,
) => Promise<void>;

export interface CommandDefinition {
  slash: SlashCommandBuilder;
  description: string;
  category: string;
  handler: CommandHandler;
}

export const commandRegistry: CommandDefinition[] = [
  {
    slash: new SlashCommandBuilder()
      .setName("start")
      .setDescription("현재 채널에서 Claude 세션 시작 (채널 이름 = 주제)")
      .addBooleanOption((opt) =>
        opt
          .setName("force")
          .setDescription("기존 세션을 강제로 종료하고 새로 시작")
          .setRequired(false),
      ) as SlashCommandBuilder,
    description: "현재 채널에서 Claude 세션 시작 (채널 이름 = 주제)",
    category: "세션",
    handler: handleStart,
  },
  {
    slash: new SlashCommandBuilder()
      .setName("stop")
      .setDescription("현재 채널 세션 종료"),
    description: "현재 채널 세션 종료",
    category: "세션",
    handler: handleStop,
  },
  {
    slash: new SlashCommandBuilder()
      .setName("cwd")
      .setDescription("작업 디렉토리 변경 (인자 없으면 현재 경로 확인)")
      .addStringOption((opt) =>
        opt
          .setName("path")
          .setDescription("작업 디렉토리 경로")
          .setRequired(false),
      ) as SlashCommandBuilder,
    description: "작업 디렉토리 변경 (인자 없으면 현재 경로 확인)",
    category: "설정",
    handler: handleSetCwd,
  },
  {
    slash: new SlashCommandBuilder()
      .setName("help")
      .setDescription("도움말 표시"),
    description: "도움말 표시",
    category: "기타",
    handler: handleHelp,
  },
];

const commandMap = new Map<string, CommandDefinition>(
  commandRegistry.map((cmd) => [cmd.slash.name, cmd]),
);

/** 지정된 길드에 슬래시 명령어를 등록한다. guild commands이므로 즉시 반영. */
export async function registerSlashCommands(guild: Guild): Promise<void> {
  const commands = commandRegistry.map((cmd) => cmd.slash.toJSON());
  await guild.commands.set(commands);
  console.log(`Registered ${commands.length} slash commands for guild ${guild.name}`);
}

/** commandName으로 핸들러를 찾아 실행한다. 등록되지 않은 명령어는 무시. */
export async function dispatchInteraction(
  interaction: ChatInputCommandInteraction,
  state: StateManager,
): Promise<void> {
  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;
  await cmd.handler(interaction, state);
}

/** commandRegistry를 카테고리별로 그룹핑하여 Discord용 도움말 텍스트를 생성한다. */
export function generateHelpText(): string {
  const grouped = new Map<string, CommandDefinition[]>();
  for (const cmd of commandRegistry) {
    const list = grouped.get(cmd.category) ?? [];
    list.push(cmd);
    grouped.set(cmd.category, list);
  }

  const sections: string[] = ["**Claude Code Bot 명령어:**"];
  for (const [category, cmds] of grouped) {
    sections.push(`\n**${category}**`);
    for (const cmd of cmds) {
      sections.push(`\`/${cmd.slash.name}\` — ${cmd.description}`);
    }
  }

  sections.push("\n**사용 방법:**");
  sections.push("1. `/cwd`로 작업 디렉토리를 설정한다.");
  sections.push("2. 원하는 채널에서 `/start`를 실행하면 세션이 시작된다.");
  sections.push("3. 채널에 메시지를 보내면 Claude와 대화할 수 있다.");
  sections.push("4. `/stop`으로 세션을 종료한다.");
  sections.push("");
  sections.push("세션이 시작되면 채널에 상태 메시지가 고정된다 (Session ID, CWD, 시작 시간).");
  sections.push("`/cwd`, `/stop` 실행 시에도 고정 메시지가 자동으로 갱신/삭제된다.");
  sections.push("세션 중 `/cwd`로 경로를 변경하면 새 세션이 생성된다.");

  return sections.join("\n");
}

async function handleHelp(
  interaction: ChatInputCommandInteraction,
  _state: StateManager,
): Promise<void> {
  await interaction.reply(generateHelpText());
}
