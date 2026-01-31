import type { Message } from "discord.js";
import type { StateManager } from "../state.js";
import { handleStart } from "./start.js";
import { handleStop } from "./stop.js";
import { handleSetCwd } from "./setCwd.js";

export type CommandHandler = (
  message: Message,
  args: string,
  state: StateManager,
) => Promise<void>;

export interface CommandDefinition {
  name: string;
  usage: string;
  description: string;
  category: string;
  handler: CommandHandler;
}

export const commandRegistry: CommandDefinition[] = [
  // 세션
  { name: "start", usage: "!start", description: "현재 채널에서 Claude 세션 시작 (채널 이름 = 주제)", category: "세션", handler: handleStart },
  { name: "stop", usage: "!stop", description: "현재 채널 세션 종료", category: "세션", handler: handleStop },

  // 작업 디렉토리
  { name: "cwd", usage: "!cwd <경로>", description: "작업 디렉토리 변경 (인자 없으면 현재 경로 확인)", category: "설정", handler: handleSetCwd },

  // 기타
  { name: "help", usage: "!help", description: "도움말 표시", category: "기타", handler: handleHelp },
];

const commandMap = new Map<string, CommandDefinition>(
  commandRegistry.map((cmd) => [cmd.name, cmd]),
);

/** Generate formatted help text from the command registry. */
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
      sections.push(`\`${cmd.usage}\` — ${cmd.description}`);
    }
  }

  return sections.join("\n");
}

export function parseCommand(content: string): { name: string; args: string } | null {
  if (!content.startsWith("!")) return null;
  const spaceIdx = content.indexOf(" ");
  const name = spaceIdx === -1 ? content.slice(1) : content.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : content.slice(spaceIdx + 1).trim();
  return { name, args };
}

export async function dispatchCommand(
  message: Message,
  state: StateManager,
): Promise<boolean> {
  const parsed = parseCommand(message.content);
  if (!parsed) return false;

  const cmd = commandMap.get(parsed.name);
  if (!cmd) return false;

  await cmd.handler(message, parsed.args, state);
  return true;
}

async function handleHelp(
  message: Message,
  _args: string,
  _state: StateManager,
): Promise<void> {
  await message.reply(generateHelpText());
}
