import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import type { ClaudeResult, ClaudeRunOptions, ClaudeRunHandle } from "./types.js";

/**
 * Claude Agent SDK를 사용하여 Claude를 실행하고 ClaudeRunHandle을 반환한다.
 * - handle.promise로 결과를 대기
 * - handle.abort()로 프로세스를 중단
 * - options.onPermissionRequest 콜백으로 도구 사용 권한을 제어
 * - thinking 블록을 캡처하여 결과에 포함
 */
export function runClaude(options: ClaudeRunOptions): ClaudeRunHandle {
  const abortController = new AbortController();

  const promise = (async (): Promise<ClaudeResult> => {
    try {
      const sdkOptions: Parameters<typeof query>[0]["options"] = {
        cwd: options.cwd || config.defaultCwd,
        abortController,
        systemPrompt: {
          type: "preset" as const,
          preset: "claude_code" as const,
          append: SYSTEM_PROMPT,
        },
        permissionMode: options.onPermissionRequest ? "default" : "bypassPermissions",
        ...(options.onPermissionRequest
          ? {
              canUseTool: async (
                toolName: string,
                input: Record<string, unknown>,
              ) => {
                const allowed = await options.onPermissionRequest!(toolName, input);
                return allowed
                  ? { behavior: "allow" as const, updatedInput: input }
                  : { behavior: "deny" as const, message: "사용자가 권한을 거부했습니다." };
              },
            }
          : {
              allowDangerouslySkipPermissions: true,
            }),
        ...(config.claudeModel ? { model: config.claudeModel } : {}),
        ...(config.claudeMaxBudget
          ? { maxBudgetUsd: parseFloat(config.claudeMaxBudget) }
          : {}),
        ...(config.claudeApiKey
          ? { env: { ...process.env, ANTHROPIC_API_KEY: config.claudeApiKey } }
          : {}),
        ...(options.sessionId
          ? options.isResume
            ? { resume: options.sessionId }
            : { extraArgs: { "session-id": options.sessionId } }
          : {}),
      };

      const q = query({ prompt: options.prompt, options: sdkOptions });

      let thinking = "";
      let text = "";

      for await (const msg of q) {
        if (msg.type === "assistant" && "message" in msg) {
          for (const block of (msg as { message: { content: Array<{ type: string; thinking?: string; text?: string }> } }).message.content) {
            if (block.type === "thinking" && block.thinking) {
              thinking += (thinking ? "\n" : "") + block.thinking;
            } else if (block.type === "text" && block.text) {
              text = block.text;
            }
          }
        } else if (msg.type === "result") {
          const resultMsg = msg as { result?: string; is_error?: boolean; errors?: string[] };
          if (resultMsg.result) {
            text = resultMsg.result;
          }
          if (resultMsg.is_error) {
            return {
              success: false,
              output: resultMsg.errors?.join("\n") || text || "Unknown error",
              thinking: thinking.trim() || undefined,
            };
          }
        }
      }

      return {
        success: true,
        output: text.trim() || "(empty response)",
        thinking: thinking.trim() || undefined,
      };
    } catch (err) {
      if (abortController.signal.aborted) {
        return { success: false, output: "응답이 중단되었습니다." };
      }
      return {
        success: false,
        output: `Failed to run claude: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  })();

  return {
    promise,
    abort: () => abortController.abort(),
  };
}
