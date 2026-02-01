import fs from "fs";
import os from "os";
import path from "path";
import YAML from "yaml";

interface ConfigFile {
  discord: {
    token: string;
    guildIds: string[];
    allowedUserIds?: string[] | null;
  };
  claude: {
    model?: string | null;
    apiKey?: string | null;
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

/** env/ 디렉토리가 없으면 생성한다. */
function ensureEnvDir(): string {
  const envDir = path.join(process.cwd(), "env");
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
  }
  return envDir;
}

/** env/config.yaml 파일을 읽어 ConfigFile 객체로 파싱한다. 파일이 없으면 예외 발생. */
function loadConfig(): ConfigFile {
  const envDir = ensureEnvDir();
  const configPath = path.join(envDir, "config.yaml");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `config.yaml not found at ${configPath}. Copy env-sample/ to env/ and edit config.yaml and fill in values.`,
    );
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return YAML.parse(raw) as ConfigFile;
}

/** yaml의 apiKey 값을 확인하고, 유효하지 않으면 환경변수 ANTHROPIC_API_KEY로 fallback한다. */
function resolveApiKey(yamlKey?: string | null): string | null {
  if (yamlKey && yamlKey !== "your_api_key") return yamlKey;
  return process.env.ANTHROPIC_API_KEY || null;
}

const file = loadConfig();

export const config = {
  discordToken: file.discord.token,
  guildIds: file.discord.guildIds,
  allowedUserIds:
    file.discord.allowedUserIds && file.discord.allowedUserIds.length > 0
      ? file.discord.allowedUserIds
      : null,
  claudeApiKey: resolveApiKey(file.claude.apiKey),
  claudeModel: file.claude.model ?? null,
  claudeMaxBudget: file.claude.maxBudgetUsd
    ? String(file.claude.maxBudgetUsd)
    : null,
  claudePath: file.claude.path
    ? file.claude.path.replace(/^~/, os.homedir())
    : "claude",
  claudeTimeout: file.claude.timeoutMs || 600_000,
  defaultCwd: (() => {
    const dir = (file.cwd.default || process.cwd()).replace(/^~/, os.homedir());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  })(),
  cwdWhitelist: file.cwd.whitelist ?? [],
  cwdBlacklist: file.cwd.blacklist ?? [],
  sessionTokenLimit: file.session.tokenLimit ?? 0,
  sessionRenewalHours: file.session.renewalHours ?? 24,
  claudeDataDir: path.join(os.homedir(), ".claude"),
  stateFilePath:
    file.stateFilePath || path.join(process.cwd(), "env", "bot-state.json"),
};

/**
 * 경로를 화이트/블랙리스트와 대조하여 검증한다.
 * 허용 시 null 반환, 거부 시 한국어 에러 메시지 반환.
 * 1. 블랙리스트 확인 (prefix 매칭, 항상 우선)
 * 2. 화이트리스트가 비어있으면 전체 허용
 * 3. 화이트리스트에 포함된 경로의 하위 디렉토리인지 확인
 */
export function validateCwdPath(dirPath: string): string | null {
  const resolved = path.resolve(dirPath);

  // 블랙리스트 우선 확인
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
