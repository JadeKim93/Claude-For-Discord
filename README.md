# Claude Code Discord Bot

Claude Code CLI를 Discord에서 제어하는 봇. 채널 단위로 세션을 관리하며, 재시작 후에도 세션이 유지된다.

## 요구사항

- Node.js 20+
- Claude Code CLI (`claude` 명령어 사용 가능)
- Discord 봇 토큰 (관리자 권한)

## 설치

```bash
npm install
```

## 설정

`config.example.yaml`을 `config.yaml`로 복사한 뒤 값을 채운다:

```bash
cp config.example.yaml config.yaml
```

```yaml
# Discord 설정
discord:
  token: "봇_토큰"
  guildId: "서버_ID"
  allowedUserIds: []           # 빈 배열이면 전체 허용

# Claude CLI 설정
claude:
  model: null                  # 모델 지정 (null이면 기본값)
  path: "/home/jade/.local/bin/claude"
  timeoutMs: 600000
  maxBudgetUsd: null           # 턴당 최대 비용 (USD)

# 작업 디렉토리 설정
cwd:
  default: "/home/jade/projects"
  whitelist: []                # 빈 배열이면 전체 접근 가능
  blacklist:
    - "/etc"
    - "/root"

# 세션 설정
session:
  tokenLimit: 100000           # 세션별 최대 토큰 (0이면 무제한)
  renewalHours: 24             # 토큰 리셋 주기 (시간)

# 상태 파일 경로
stateFilePath: "./bot-state.json"
```

| 설정 | 필수 | 설명 |
|------|------|------|
| `discord.token` | O | Discord 봇 토큰 |
| `discord.guildId` | O | 봇이 동작할 서버 ID |
| `discord.allowedUserIds` | X | 허용할 사용자 ID 배열 (빈 배열이면 전체 허용) |
| `claude.model` | X | Claude 모델 지정 |
| `claude.maxBudgetUsd` | X | 턴당 최대 비용 제한 (USD) |
| `claude.path` | X | Claude CLI 경로 |
| `claude.timeoutMs` | X | CLI 타임아웃 ms (기본: 600000) |
| `cwd.default` | X | 기본 작업 디렉토리 |
| `cwd.whitelist` | X | 허용 경로 배열 (빈 배열이면 전체 허용) |
| `cwd.blacklist` | X | 차단 경로 배열 (화이트리스트보다 우선) |
| `session.tokenLimit` | X | 세션별 최대 토큰 수 (0이면 무제한) |
| `session.renewalHours` | X | 토큰 리셋 주기 (기본: 24시간) |
| `stateFilePath` | X | 상태 파일 경로 (기본: `./bot-state.json`) |

## 실행

### 직접 실행

```bash
# 개발 모드
npx tsx src/index.ts

# 빌드 후 실행
npx tsc && node dist/index.js
```

### PM2로 실행 (권장)

PM2를 사용하면 크래시 시 자동 재시작되고, 시스템 재부팅 후에도 자동 실행된다.

```bash
# PM2 설치
npm install -g pm2

# 빌드
npx tsc

# PM2로 시작
pm2 start dist/index.js --name claude-discord

# 로그 확인
pm2 logs claude-discord

# 시스템 재부팅 후 자동 시작 설정
pm2 startup
pm2 save
```

PM2 주요 명령어:

```bash
pm2 status                  # 상태 확인
pm2 restart claude-discord  # 재시작
pm2 stop claude-discord     # 중지
pm2 delete claude-discord   # PM2에서 제거
```

### Docker로 실행

Dockerfile을 생성한 뒤:

```bash
# 이미지 빌드
docker build -t claude-discord .

# 실행
docker run -d \
  --name claude-discord \
  --restart unless-stopped \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v /home/jade/.claude:/home/node/.claude \
  -v /home/jade/projects:/home/node/projects \
  -v $(pwd)/bot-state.json:/app/bot-state.json \
  claude-discord
```

볼륨 마운트 설명:
- `config.yaml` — 설정 파일 (읽기 전용)
- `/home/jade/.claude` — Claude CLI 설정 및 세션 데이터
- `/home/jade/projects` — 작업 디렉토리 (CWD로 사용할 경로)
- `bot-state.json` — 봇 상태 파일 (세션 매핑 유지)

Docker Compose:

```yaml
services:
  claude-discord:
    build: .
    restart: unless-stopped
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - /home/jade/.claude:/home/node/.claude
      - /home/jade/projects:/home/node/projects
      - ./bot-state.json:/app/bot-state.json
```

## 세션 영속성

봇은 `bot-state.json` 파일에 세션 매핑을 저장한다. 이 파일이 유지되는 한 봇을 재시작하거나 시스템을 재부팅해도 세션이 보존된다.

- `!start`로 시작한 세션은 즉시 `bot-state.json`에 기록된다.
- 봇 종료 시 (`SIGINT`/`SIGTERM`) 상태를 즉시 저장한다.
- 재시작 후 동일 채널에서 메시지를 보내면 이전 세션이 자동으로 이어진다.
- Claude CLI의 `--resume` 플래그를 사용하여 대화 맥락을 복원한다.

상태 파일을 백업하려면:

```bash
cp bot-state.json bot-state.json.bak
```

## 명령어

| 명령어 | 설명 |
|--------|------|
| `!start` | 현재 채널에서 Claude 세션을 시작한다 (채널 이름 = 주제). |
| `!stop` | 현재 채널의 세션을 종료한다. |
| `!cwd <경로>` | 작업 디렉토리를 변경한다. 인자 없으면 현재 경로 확인. |
| `!help` | 도움말을 표시한다. |

## 사용 흐름

```
1. 봇 실행
2. !cwd /home/jade/my-project     ← 작업 디렉토리 설정
3. 원하는 채널에서 !start          ← 세션 시작 (채널 이름이 주제)
4. 인증 모듈 분석해줘                ← Claude에게 메시지 전달
5. Claude 응답 수신
6. 선택지가 있으면 이모지 버튼으로 선택
7. !stop                          ← 세션 종료
```

## 기능 상세

### 채널 기반 세션

`!start`로 세션을 시작하면 Discord 채널 이름이 세션 주제가 된다. 세션이 활성화된 채널에서는 일반 메시지가 Claude에게 전달되며, 대화 맥락이 유지된다. `!start` 전에는 메시지에 개입하지 않는다.

### 고정 메시지

세션 시작 시 채널에 상태 메시지가 고정된다 (Session ID, CWD, 시작 시간). CWD 변경 시 자동 갱신되고, `!stop` 시 삭제된다.

### 시스템 채널

봇이 시작되면 두 개의 시스템 채널을 자동 관리한다:

- **서버-알람** — 봇 온라인 알림 및 토큰 사용량 알림 전송
- **서버-안내** — 매 시작마다 초기화 후 도움말 표시 (일반 유저 채팅 불가)

### CWD 화이트리스트/블랙리스트

`config.yaml`의 `cwd.whitelist`와 `cwd.blacklist`로 `!cwd` 명령어에서 접근 가능한 경로를 제한한다.

- **화이트리스트가 빈 배열**: 모든 경로 접근 가능 (블랙리스트만 적용)
- **화이트리스트에 경로 지정**: 해당 경로의 하위 디렉토리만 허용
- **블랙리스트**: 항상 우선 적용되며, 지정 경로와 하위 디렉토리를 차단

### 토큰 사용량 추적

세션별로 입출력 토큰과 비용을 추적한다. `session.tokenLimit`이 0보다 크면:

- 10% 간격 (10%, 20%, ..., 90%)으로 `서버-알람` 채널에 알림
- 95%, 98%에 추가 알림
- 100% 초과 시 세션 차단 + 다음 갱신 시간 안내
- `session.renewalHours` 주기마다 토큰이 자동 초기화되며, 갱신 시에도 알림

### 긴 응답 처리

- 2000자 이하: 직접 전송
- 6000자 이하: 여러 메시지로 분할
- 6000자 초과: 미리보기 + `response.md` 파일 첨부

### 이모지 선택지

Claude가 번호 목록 형태의 선택지를 제시하면 별도 메시지에 숫자 이모지(1~9)가 표시된다. 이모지를 클릭하면 해당 선택이 Claude에게 자동 전달된다. 120초 내 선택하지 않으면 시간 초과 처리된다.

### 시스템 프롬프트 커스터마이징

`src/systemPrompt.ts` 파일에서 Claude에게 전달되는 시스템 프롬프트를 수정할 수 있다. 이 프롬프트는 모든 Claude CLI 호출에 `--append-system-prompt` 플래그로 전달된다.

```typescript
// src/systemPrompt.ts
export const SYSTEM_PROMPT = [
  "선택지는 반드시 번호 목록으로 제시할 것",
  "",
  "SECURITY: ...",
].join("\n");
```

수정 후 빌드를 다시 실행해야 적용된다:

```bash
npx tsc && pm2 restart claude-discord
```

### 보안

- `.env`, API 키, 토큰 등 민감한 파일 읽기 요청은 Claude가 자동 거부한다 (시스템 프롬프트에서 제어).
- `discord.allowedUserIds`로 봇 사용 가능한 Discord 유저를 제한할 수 있다.
- `cwd.blacklist`로 민감한 디렉토리 접근을 차단할 수 있다.

## 프로젝트 구조

```
src/
  index.ts                  — 진입점
  config.ts                 — YAML 설정 로드, CWD 경로 검증
  types.ts                  — TypeScript 인터페이스
  state.ts                  — 상태 관리 (JSON 영속화)
  claude.ts                 — Claude CLI 실행 (JSON 출력 파싱)
  systemPrompt.ts           — 시스템 프롬프트 (커스터마이징 가능)
  utils.ts                  — 경로 인코딩, 고정 메시지 유틸
  bot.ts                    — Discord 클라이언트, 이벤트 라우팅, 토큰 알림
  commands/
    index.ts                — 커맨드 레지스트리 & 디스패처
    start.ts                — !start
    stop.ts                 — !stop
    setCwd.ts               — !cwd (화이트/블랙리스트 검증)
  channels/
    messageSender.ts        — 2000자 분할, 파일 첨부
  interactions/
    reactionHandler.ts      — 이모지 선택지
config.yaml                 — 봇 설정 (gitignore)
config.example.yaml         — 설정 예제
```
