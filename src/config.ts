import fs from "fs";
import os from "os";
import path from "path";
import YAML from "yaml";

interface ConfigFile {
  discord: {
    token: string;
    guildId: string;
    allowedUserIds?: string[] | null;
  };
  claude: {
    model?: string | null;
    path?: string;
    timeoutMs?: number;
    maxBudgetUsd?: string | null;
  };
  cwd: {
    default?: string;
    whitelist?: string[];
    blacklist?: string[];
  };
  session: {
    tokenLimit?: number;
    renewalHours?: number;
  };
  stateFilePath?: string;
}

function loadConfig(): ConfigFile {
  const configPath = path.join(process.cwd(), "config.yaml");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `config.yaml not found at ${configPath}. Copy config.example.yaml to config.yaml and fill in values.`,
    );
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return YAML.parse(raw) as ConfigFile;
}

const file = loadConfig();

export const config = {
  discordToken: file.discord.token,
  guildId: file.discord.guildId,
  allowedUserIds:
    file.discord.allowedUserIds && file.discord.allowedUserIds.length > 0
      ? file.discord.allowedUserIds
      : null,
  claudeModel: file.claude.model ?? null,
  claudeMaxBudget: file.claude.maxBudgetUsd
    ? String(file.claude.maxBudgetUsd)
    : null,
  claudePath: file.claude.path || "/home/jade/.local/bin/claude",
  claudeTimeout: file.claude.timeoutMs || 600_000,
  defaultCwd: file.cwd.default || process.cwd(),
  cwdWhitelist: file.cwd.whitelist ?? [],
  cwdBlacklist: file.cwd.blacklist ?? [],
  sessionTokenLimit: file.session.tokenLimit ?? 0,
  sessionRenewalHours: file.session.renewalHours ?? 24,
  claudeDataDir: path.join(os.homedir(), ".claude"),
  stateFilePath:
    file.stateFilePath || path.join(process.cwd(), "bot-state.json"),
};

/**
 * Validate a directory path against the whitelist/blacklist.
 * Returns null if allowed, or an error message string if denied.
 */
export function validateCwdPath(dirPath: string): string | null {
  const resolved = path.resolve(dirPath);

  // Blacklist always takes priority
  for (const blocked of config.cwdBlacklist) {
    const resolvedBlocked = path.resolve(blocked);
    if (
      resolved === resolvedBlocked ||
      resolved.startsWith(resolvedBlocked + "/")
    ) {
      return `경로가 블랙리스트에 포함되어 있습니다: \`${blocked}\``;
    }
  }

  // If whitelist is empty, allow all
  if (config.cwdWhitelist.length === 0) {
    return null;
  }

  // Check if path is under any whitelisted directory
  for (const allowed of config.cwdWhitelist) {
    const resolvedAllowed = path.resolve(allowed);
    if (
      resolved === resolvedAllowed ||
      resolved.startsWith(resolvedAllowed + "/")
    ) {
      return null;
    }
  }

  return `경로가 화이트리스트에 포함되지 않습니다. 허용된 경로: ${config.cwdWhitelist.map((p) => `\`${p}\``).join(", ")}`;
}
