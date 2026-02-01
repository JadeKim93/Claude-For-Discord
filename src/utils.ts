import fs from "fs";
import path from "path";
import readline from "readline";
import type { TextChannel } from "discord.js";
import { config } from "./config.js";
import type { SessionMapping, SessionUsage } from "./types.js";

/** 디렉토리 경로를 Claude의 projects 디렉토리명으로 변환한다. "/home/jade" → "-home-jade" */
export function encodeProjectPath(dirPath: string): string {
  return dirPath.replace(/\//g, "-");
}

const PIN_TAG = "[claude-bot-status]";

/** 채널에 고정할 세션 상태 메시지를 생성한다. PIN_TAG로 시작하여 식별 가능. */
export function buildStatusMessage(session: SessionMapping): string {
  return [
    PIN_TAG,
    `**Session:** \`${session.sessionId.slice(0, 8)}\``,
    `**CWD:** \`${session.projectPath}\``,
    `**Started:** ${new Date(session.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
  ].join("\n");
}

/** 채널의 고정 메시지 중 봇이 작성한 상태 메시지를 모두 삭제한다. */
export async function removeStatusPin(
  channel: TextChannel,
  botUserId: string,
): Promise<void> {
  try {
    const pinned = await channel.messages.fetchPinned();
    for (const msg of pinned.values()) {
      if (msg.author.id === botUserId && msg.content.startsWith(PIN_TAG)) {
        await msg.delete().catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

/** 기존 상태 고정 메시지를 삭제하고 새 상태 메시지를 전송·고정한다. */
export async function pinStatusMessage(
  channel: TextChannel,
  session: SessionMapping,
  botUserId: string,
): Promise<void> {
  await removeStatusPin(channel, botUserId);
  const statusMsg = await channel.send(buildStatusMessage(session));
  await statusMsg.pin().catch(() => {});
}

/**
 * Claude CLI의 JSONL 세션 파일을 읽어 누적 토큰 사용량을 반환한다.
 * 매 호출마다 전체 파일을 스트리밍 파싱하므로, 세션이 길면 비용 증가.
 *
 * 경로: ~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl
 * assistant 메시지의 usage에서 input/cache/output 토큰을 합산.
 */
export async function getSessionUsage(
  sessionId: string,
  projectPath: string,
): Promise<SessionUsage> {
  const encoded = encodeProjectPath(projectPath);
  const jsonlPath = path.join(
    config.claudeDataDir,
    "projects",
    encoded,
    `${sessionId}.jsonl`,
  );

  const usage: SessionUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  if (!fs.existsSync(jsonlPath)) return usage;

  const stream = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const msg = obj?.message;
      if (obj?.type === "assistant" && msg?.usage) {
        usage.inputTokens +=
          (msg.usage.input_tokens ?? 0) +
          (msg.usage.cache_creation_input_tokens ?? 0);
        usage.outputTokens += msg.usage.output_tokens ?? 0;
      }
    } catch {
      // skip malformed lines
    }
  }

  // Estimate cost from modelUsage isn't available per-line,
  // so we use input+output token pricing approximation is not reliable.
  // Cost will be taken from the per-call JSON result instead.
  return usage;
}
