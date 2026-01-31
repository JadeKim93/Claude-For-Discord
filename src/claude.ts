import { spawn } from "child_process";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import type { ClaudeResult, ClaudeRunOptions } from "./types.js";

interface ClaudeJsonResponse {
  result?: string;
}

export function runClaude(options: ClaudeRunOptions): Promise<ClaudeResult> {
  return new Promise((resolve) => {
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

    const proc = spawn(config.claudePath, args, {
      cwd: options.cwd || config.defaultCwd,
      env: { ...process.env },
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

    // Manual timeout with SIGTERM → SIGKILL fallback
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    }, config.claudeTimeout);

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
