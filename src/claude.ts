import { spawn } from "child_process";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import type { ClaudeResult, ClaudeRunOptions } from "./types.js";

interface ClaudeJsonResponse {
  result?: string;
}

/**
 * Claude CLI를 서브프로세스로 실행하고 JSON 결과를 파싱하여 반환한다.
 * 에러 시에도 reject하지 않고 success=false로 resolve한다.
 *
 * 1. CLI 인자 조립 (--print, --output-format json, 세션/모델/예산 등)
 * 2. spawn으로 프로세스 실행 (stdin 무시, stdout/stderr 파이프)
 * 3. 타임아웃 타이머 설정 (SIGTERM → 5초 후 SIGKILL)
 * 4. 종료 시 exit code에 따라 결과 분기:
 *    - 0: JSON 파싱하여 result 필드 추출 (실패 시 raw stdout)
 *    - SIGTERM/143: 타임아웃 메시지
 *    - 기타: stderr 또는 exit code 메시지
 */
export function runClaude(options: ClaudeRunOptions): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    // 1. CLI 인자 조립
    const args = ["--print", "--output-format", "json", "--dangerously-skip-permissions"];

    args.push("--append-system-prompt", SYSTEM_PROMPT);

    if (options.sessionId) {
      if (options.isResume) {
        args.push("--resume", options.sessionId);
      } else {
        args.push("--session-id", options.sessionId);
      }
    }

    if (config.claudeModel) {
      args.push("--model", config.claudeModel);
    }

    if (config.claudeMaxBudget) {
      args.push("--max-budget-usd", config.claudeMaxBudget);
    }

    args.push("-p", options.prompt);

    // 2. 프로세스 실행
    const proc = spawn(config.claudePath, args, {
      cwd: options.cwd || config.defaultCwd,
      env: {
        ...process.env,
        ...(config.claudeApiKey ? { ANTHROPIC_API_KEY: config.claudeApiKey } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // 3. 타임아웃: SIGTERM → 5초 대기 → SIGKILL
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    }, config.claudeTimeout);

    // 4. 종료 시 exit code에 따라 결과 분기
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          const json: ClaudeJsonResponse = JSON.parse(stdout);
          resolve({
            success: true,
            output: json.result?.trim() || "(empty response)",
          });
        } catch {
          resolve({
            success: true,
            output: stdout.trim() || "(empty response)",
          });
        }
      } else if (signal === "SIGTERM" || code === 143) {
        resolve({
          success: false,
          output: `Timeout: Claude did not respond within ${Math.round(config.claudeTimeout / 1000)}s`,
        });
      } else {
        resolve({
          success: false,
          output: stderr.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: `Failed to run claude: ${err.message}`,
      });
    });
  });
}
