import fs from "fs";
import path from "path";
import readline from "readline";
import type { TextChannel } from "discord.js";
import { config } from "./config.js";
import type { SessionMapping, SessionUsage } from "./types.js";

/** Encode a directory path for Claude's projects directory structure. */
export function encodeProjectPath(dirPath: string): string {
  return dirPath.replace(/\//g, "-").replace(/^-/, "");
}

const PIN_TAG = "[claude-bot-status]";

/** Build a status message string for a session. */
export function buildStatusMessage(session: SessionMapping): string {
  return [
    PIN_TAG,
    `**Session:** \`${session.sessionId.slice(0, 8)}\``,
    `**CWD:** \`${session.projectPath}\``,
    `**Started:** ${new Date(session.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
  ].join("\n");
}

/** Remove any bot-pinned status messages from the channel. */
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

/**
 * Pin (or update) a status message in the channel.
 * Removes any previous bot-pinned status message first.
 */
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
 * Read a session's JSONL file and sum all usage from assistant messages.
 * Returns the absolute total token usage for the session.
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
          (msg.usage.cache_creation_input_tokens ?? 0) +
          (msg.usage.cache_read_input_tokens ?? 0);
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
