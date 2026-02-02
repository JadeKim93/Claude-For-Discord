export interface BotState {
  sessions: Record<string, SessionMapping>;
  channelCwd: Record<string, string>;
}

export interface SessionMapping {
  sessionId: string;
  channelId: string;
  topicName: string;
  projectPath: string;
  createdAt: string;
  messageCount: number;
  lastAlertPercent: number;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ClaudeResult {
  success: boolean;
  output: string;
  thinking?: string;
}

/**
 * 권한 요청 콜백.
 * toolName과 input을 받아 허용 여부를 반환한다.
 */
export type PermissionCallback = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<boolean>;

export interface ClaudeRunOptions {
  prompt: string;
  sessionId?: string;
  isResume?: boolean;
  cwd?: string;
  onPermissionRequest?: PermissionCallback;
}

/** runClaude가 반환하는 핸들. 결과 대기와 중단이 가능하다. */
export interface ClaudeRunHandle {
  promise: Promise<ClaudeResult>;
  abort: () => void;
}
