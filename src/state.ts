import fs from "fs";
import type { BotState, SessionMapping } from "./types.js";

const DEFAULT_STATE: BotState = {
  sessions: {},
  guildCwd: {},
};

export class StateManager {
  private state: BotState = { ...DEFAULT_STATE };
  private filePath: string;
  private writeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): void {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      this.state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  }

  private scheduleSave(): void {
    if (this.writeTimeout) clearTimeout(this.writeTimeout);
    this.writeTimeout = setTimeout(() => this.saveImmediate(), 500);
  }

  saveImmediate(): void {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  // Session CRUD
  addSession(mapping: SessionMapping): void {
    this.state.sessions[mapping.channelId] = mapping;
    this.scheduleSave();
  }

  removeSession(channelId: string): SessionMapping | null {
    const session = this.state.sessions[channelId];
    if (session) {
      delete this.state.sessions[channelId];
      this.scheduleSave();
      return session;
    }
    return null;
  }

  getSessionByChannelId(channelId: string): SessionMapping | undefined {
    return this.state.sessions[channelId];
  }

  getAllSessions(): SessionMapping[] {
    return Object.values(this.state.sessions);
  }

  updateSessionMessageCount(channelId: string, count: number): void {
    const session = this.state.sessions[channelId];
    if (session) {
      session.messageCount = count;
      this.scheduleSave();
    }
  }

  // Token alert tracking
  updateSessionAlertPercent(channelId: string, percent: number): void {
    const session = this.state.sessions[channelId];
    if (session) {
      session.lastAlertPercent = percent;
      this.scheduleSave();
    }
  }

  // Working directory
  setCwd(guildId: string, cwd: string): void {
    this.state.guildCwd[guildId] = cwd;
    this.scheduleSave();
  }

  getCwd(guildId: string): string | undefined {
    return this.state.guildCwd[guildId];
  }
}
