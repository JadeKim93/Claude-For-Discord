import fs from "fs";
import type { BotState, SessionMapping } from "./types.js";

const DEFAULT_STATE: BotState = {
  sessions: {},
  guildCwd: {},
};

/**
 * JSON 파일 기반 상태 관리자.
 * 변경 시 500ms 디바운스로 저장, 종료 시 saveImmediate()로 즉시 저장.
 */
export class StateManager {
  private state: BotState = { ...DEFAULT_STATE };
  private filePath: string;
  private writeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** 파일에서 상태를 메모리로 로드한다. 파일이 없으면 기본값 사용. */
  load(): void {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      this.state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  }

  /** 500ms 후 저장 예약. 연속 호출 시 마지막 호출 기준으로 디바운스. */
  private scheduleSave(): void {
    if (this.writeTimeout) clearTimeout(this.writeTimeout);
    this.writeTimeout = setTimeout(() => this.saveImmediate(), 500);
  }

  /** 대기 중인 디바운스를 취소하고 즉시 디스크에 기록한다. 종료 시 호출. */
  saveImmediate(): void {
    if (this.writeTimeout) {
      clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  /** 세션을 추가하거나 갱신한다 (channelId 기준). */
  addSession(mapping: SessionMapping): void {
    this.state.sessions[mapping.channelId] = mapping;
    this.scheduleSave();
  }

  /** 세션을 제거하고 제거된 세션을 반환한다. 없으면 null. */
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

  /** 세션의 메시지 카운트를 갱신한다. resume 판단에 사용. */
  updateSessionMessageCount(channelId: string, count: number): void {
    const session = this.state.sessions[channelId];
    if (session) {
      session.messageCount = count;
      this.scheduleSave();
    }
  }

  /** 마지막 토큰 알림 퍼센트를 갱신한다. 중복 알림 방지용. */
  updateSessionAlertPercent(channelId: string, percent: number): void {
    const session = this.state.sessions[channelId];
    if (session) {
      session.lastAlertPercent = percent;
      this.scheduleSave();
    }
  }

  /** 길드별 기본 작업 디렉토리를 설정한다. */
  setCwd(guildId: string, cwd: string): void {
    this.state.guildCwd[guildId] = cwd;
    this.scheduleSave();
  }

  getCwd(guildId: string): string | undefined {
    return this.state.guildCwd[guildId];
  }
}
