export interface BotState {
  sessions: Record<string, SessionMapping>;
  guildCwd: Record<string, string>;
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
}

export interface ClaudeRunOptions {
  prompt: string;
  sessionId?: string;
  isResume?: boolean;
  cwd?: string;
}
