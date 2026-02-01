# CLAUDE.md — Claude Discord Bot 유지보수 가이드

## 프로젝트 개요

Discord 채널에서 Claude Code CLI를 사용할 수 있게 하는 봇.
채널 단위로 세션을 관리하며, `--print` 모드 + `--resume`으로 대화 맥락을 유지한다.

## 기술 스택

- **런타임**: Node.js 20+, TypeScript (ES2022, ESM)
- **패키지**: discord.js v14, yaml
- **외부 의존**: Claude Code CLI (`claude` 바이너리)
- **빌드**: `npx tsc` → `dist/`, 개발 시 `npx tsx src/index.ts`

## 디렉토리 구조

```
src/
  index.ts              진입점. StateManager 로드, 봇 생성, 시그널 핸들러
  config.ts             env/config.yaml 로드, env/ 자동 생성, CWD 경로 검증
  types.ts              인터페이스 정의 (SessionMapping, ClaudeResult 등)
  state.ts              StateManager — JSON 파일 기반 상태 영속화 (500ms 디바운스)
  claude.ts             Claude CLI 서브프로세스 실행 및 JSON 출력 파싱
  systemPrompt.ts       --append-system-prompt로 전달되는 시스템 프롬프트
  utils.ts              경로 인코딩, 고정 메시지, JSONL 기반 토큰 사용량 조회
  bot.ts                Discord 클라이언트, 이벤트 라우팅, 세션 메시지 처리, 토큰 알림
  commands/
    index.ts            슬래시 명령어 레지스트리, 등록(registerSlashCommands), 디스패치
    start.ts            /start — 세션 생성
    stop.ts             /stop — 세션 종료
    setCwd.ts           /cwd — 작업 디렉토리 변경/확인
  channels/
    messageSender.ts    긴 응답 분할 전송 (2000자/6000자 기준)
  interactions/
    reactionHandler.ts  번호 목록 감지 → 이모지 리액션 → 선택 대기
```

## 핵심 데이터 흐름

```
유저 메시지 → bot.ts messageCreate
  → 세션 확인 (state)
  → 토큰 한도 체크 (JSONL 파싱)
  → runClaude() (claude.ts, 서브프로세스 spawn)
  → sendLongMessage() (분할/첨부)
  → handleChoices() (선택지 감지 시 리액션 추가, 선택 시 재귀 호출)
  → checkTokenAlerts() (임계값 초과 시 서버-알람 채널)
```

## 세션 생명주기

1. `/start` → UUID 생성, state에 저장, 고정 메시지 핀
2. 유저 메시지 → `messageCount === 0`이면 `--session-id`, 이후 `--resume`
3. `/cwd` (세션 중) → **새 UUID 생성**, messageCount 초기화. Claude CLI 세션이 프로젝트 경로에 종속되므로 경로 변경 시 새 세션 필수
4. `/stop` → state에서 제거, 고정 메시지 삭제

## Claude CLI 호출 방식

```bash
claude --print --output-format json --dangerously-skip-permissions \
  --append-system-prompt "..." \
  [--session-id <id> | --resume <id>] \
  [--model <model>] [--max-budget-usd <budget>] \
  -p "<prompt>"
```

- `--print`: 비대화형 모드, 전체 응답 완료 후 출력
- `--dangerously-skip-permissions`: Discord에서 도구 승인 불가하므로 필수
- `--output-format json`: `{ "result": "텍스트", ... }` 형식 출력
- cwd는 `spawn()`의 `cwd` 옵션으로 전달
- 타임아웃: SIGTERM → 5초 대기 → SIGKILL

## 토큰 추적

- 봇 내부에서 누적하지 않음 (외부에서 세션 사용 가능)
- `~/.claude/projects/{encoded-path}/{sessionId}.jsonl`을 매번 스트리밍 파싱
- assistant 메시지의 `usage` 필드에서 input_tokens + cache 토큰 + output_tokens 합산
- 임계값: 10%, 20%, ..., 90%, 95%, 98%, 100%
- `lastAlertPercent`로 중복 알림 방지 (state에 저장)

## 상태 저장

- `env/bot-state.json`에 JSON으로 저장
- 구조: `{ sessions: { [channelId]: SessionMapping }, guildCwd: { [guildId]: path } }`
- 변경 시 500ms 디바운스로 저장, 종료 시 즉시 저장

## 이모지 선택지

- `parseChoices()`: 응답의 **마지막 연속 번호 블록**만 감지 (2~9개)
- 정규식: `^\s*(?:[-*]\s*)?(?:\*{0,2})(\d+)[.)]\*{0,2}\s+(.+)$`
- 응답 메시지에 직접 1️⃣~9️⃣ 리액션 추가
- 유저 선택 시 메시지 편집으로 기록, 선택 텍스트를 promptOverride로 재귀 호출
- 120초 타임아웃

## 긴 응답 처리

- ≤2000자: 단일 메시지
- ≤6000자: 줄바꿈/공백 기준 분할 전송
- >6000자: 미리보기 + `response.md` 파일 첨부
- 반환값 `Message[]`는 선택지 리액션 대상으로 사용

## 시스템 채널

- **서버-알람**: 봇 온라인 알림, 토큰 사용량 경고. 유저 채팅 불가
- **서버-안내**: 봇 시작 시 기존 메시지 삭제 후 도움말 재게시. 유저 채팅 불가
- 채널이 없으면 자동 생성

## 설정 (config.yaml)

YAML로 관리. `env/config.yaml` (샘플: `env-sample/config.yaml`). 주요 항목:
- `discord.allowedUserIds`: 빈 배열이면 전체 허용, null도 전체 허용
- `cwd.whitelist`: 빈 배열이면 제한 없음 (blacklist만 적용)
- `cwd.blacklist`: 항상 우선. prefix 매칭 (`path.resolve` 기반)
- `session.tokenLimit`: 0이면 무제한
- `claudeDataDir`: `~/.claude` (하드코딩, config에 없음)

## 빌드 & 실행

```bash
npm install
npx tsc --noEmit     # 타입 체크
npx tsc              # 빌드
npx tsx src/index.ts # 개발 모드
```

## 코드 컨벤션

- async/await 일관 사용, Promise reject 대신 resolve로 에러 반환 (claude.ts)
- 옵셔널 체이닝 (`?.`), nullish coalescing (`??`) 적극 사용
- `console.log`로 구조화 로깅: `[timestamp] [IN/OUT] #channel @author: preview`
- 상태 변경 메서드 호출 → `scheduleSave()` 자동 트리거
- 슬래시 명령어 핸들러: `(interaction: ChatInputCommandInteraction, state: StateManager) => Promise<void>`

## 주의사항

- `--dangerously-skip-permissions` 사용 중. 신뢰할 수 있는 유저만 `allowedUserIds`에 등록할 것
- `/cwd` 변경 시 세션이 리셋됨 (Claude CLI 세션이 프로젝트 경로에 종속)
- 시스템 프롬프트 변경 시 빌드 재실행 필요
- `getSessionUsage()`는 매 호출마다 JSONL 전체를 파싱하므로, 세션이 매우 길어지면 성능 저하 가능
- guild commands로 등록하므로 즉시 반영됨 (global commands와 달리 캐시 지연 없음)
- 기본적으로 .gitignore 에 해당하는 파일 리스트는 수정 대상이 아님. 특별히 지시자가 현재 세팅에 대해 요청한 것이 아니라면, 이 외의 파일을 수정할 것