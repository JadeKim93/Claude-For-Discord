# Claude Code Discord Bot

Claude Code CLI를 Discord에서 제어하는 봇. 채널 단위로 세션을 관리하며, 재시작 후에도 세션이 유지된다.

## Quick Start (Docker Compose)

```bash
# 1. env-sample을 env로 복사
cp -r env-sample env
# env/config.yaml에 Discord 토큰, 서버 ID 등을 입력한다.

# 2. 실행
docker compose build --no-cache
docker compose up -d

# 로그 확인
docker compose logs -f
```

> `env/` 폴더에 `config.yaml`과 `bot-state.json`이 관리된다. 볼륨 마운트 경로(`~/.claude`, `~/projects`)는 `docker-compose.yml`에서 환경에 맞게 수정한다.

---

## 요구사항

- Node.js 20+
- Claude Code CLI (`claude` 명령어 사용 가능)
- Discord 봇 토큰 (관리자 권한)

## 설치

```bash
npm install
```

## 설정

`env-sample/`을 `env/`로 복사한 뒤 값을 채운다:

```bash
cp -r env-sample env
```

```yaml
# Discord 설정
discord:
  token: "봇_토큰"
  guildIds:
    - "서버_ID"
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
stateFilePath: "./env/bot-state.json"
```

| 설정 | 필수 | 설명 |
|------|------|------|
| `discord.token` | O | Discord 봇 토큰 |
| `discord.guildIds` | O | 봇이 동작할 서버 ID 배열 |
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
| `stateFilePath` | X | 상태 파일 경로 (기본: `./env/bot-state.json`) |

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

### Docker Compose로 실행 (권장)

```bash
docker compose up -d
```

`docker-compose.yml`의 볼륨 마운트를 환경에 맞게 수정한다:

- `env/` — 설정 파일(`config.yaml`)과 상태 파일(`bot-state.json`)
- `~/.claude` — Claude CLI 설정 및 세션 데이터
- `~/projects` — 작업 디렉토리 (CWD로 사용할 경로)

## 세션 영속성

봇은 `env/bot-state.json` 파일에 세션 매핑을 저장한다. 이 파일이 유지되는 한 봇을 재시작하거나 시스템을 재부팅해도 세션이 보존된다.

- `/start`로 시작한 세션은 즉시 `env/bot-state.json`에 기록된다.
- 봇 종료 시 (`SIGINT`/`SIGTERM`) 상태를 즉시 저장한다.
- 재시작 후 동일 채널에서 메시지를 보내면 이전 세션이 자동으로 이어진다.
- Claude CLI의 `--resume` 플래그를 사용하여 대화 맥락을 복원한다.

상태 파일을 백업하려면:

```bash
cp env/bot-state.json env/bot-state.json.bak
```

## 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 현재 채널에서 Claude 세션을 시작한다 (채널 이름 = 주제). |
| `/stop` | 현재 채널의 세션을 종료한다. |
| `/cwd path:<경로>` | 작업 디렉토리를 변경한다. 인자 없으면 현재 경로 확인. |
| `/help` | 도움말을 표시한다. |

## 사용 흐름

```
1. 봇 실행
2. /cwd path:/home/jade/my-project   ← 작업 디렉토리 설정
3. 원하는 채널에서 /start             ← 세션 시작 (채널 이름이 주제)
4. 인증 모듈 분석해줘                   ← Claude에게 메시지 전달
5. Claude 응답 수신
6. 선택지가 있으면 이모지 버튼으로 선택
7. /stop                             ← 세션 종료
```

## 기능 상세

### 채널 기반 세션

`/start`로 세션을 시작하면 Discord 채널 이름이 세션 주제가 된다. 세션이 활성화된 채널에서는 일반 메시지가 Claude에게 전달되며, 대화 맥락이 유지된다. `/start` 전에는 메시지에 개입하지 않는다.

### 고정 메시지

세션 시작 시 채널에 상태 메시지가 고정된다 (Session ID, CWD, 시작 시간). CWD 변경 시 자동 갱신되고, `/stop` 시 삭제된다.

### 시스템 채널

봇이 시작되면 두 개의 시스템 채널을 자동 관리한다:

- **서버-알람** — 봇 온라인 알림 및 토큰 사용량 알림 전송
- **서버-안내** — 매 시작마다 초기화 후 도움말 표시 (일반 유저 채팅 불가)

### CWD 화이트리스트/블랙리스트

`config.yaml`의 `cwd.whitelist`와 `cwd.blacklist`로 `/cwd` 명령어에서 접근 가능한 경로를 제한한다.

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

Claude가 번호 목록 형태의 선택지를 제시하면 응답 메시지에 숫자 이모지(1~9) 리액션이 추가된다. 이모지를 클릭하면 해당 선택이 Claude에게 자동 전달되고, 선택 결과가 메시지에 편집으로 남는다. 120초 내 선택하지 않으면 시간 초과 처리된다.

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

## Disclaimer

### 기능적 한계

이 봇은 Discord 메시지를 Claude Code CLI에 `--print` 모드로 중계하는 구조이다. 이로 인해 다음과 같은 한계가 있다:

- **단방향 프롬프트 모드**: Claude Code의 대화형(interactive) 기능을 사용할 수 없다. 매 메시지가 독립적인 `--print` 호출이며, `--resume`으로 세션 맥락만 유지한다.
- **도구 승인 불가**: Discord 환경에서는 Claude가 도구(tool) 사용 전 사용자에게 승인을 요청하는 인터랙션이 불가능하다. 이 때문에 `--dangerously-skip-permissions` 플래그를 사용하여 모든 도구 실행을 자동 승인한다.
- **실시간 스트리밍 없음**: `--print` 모드는 전체 응답이 완료된 후 한 번에 출력된다. 응답 생성 중간 과정을 실시간으로 볼 수 없다.
- **파일 첨부 미지원**: Discord 메시지의 이미지나 파일 첨부를 Claude에게 전달하지 않는다. 텍스트 메시지만 처리된다.

### 보안 고려사항

`--dangerously-skip-permissions` 플래그는 Claude가 파일 읽기/쓰기, 명령어 실행 등 모든 도구를 사용자 승인 없이 실행할 수 있게 한다. 이는 Discord에서 대화형 승인이 불가능하기 때문에 필요한 조치이지만, 다음과 같은 위험이 존재한다:

- Claude가 시스템 파일을 수정하거나 임의의 명령어를 실행할 수 있다
- 프롬프트 인젝션 공격에 취약할 수 있다

이를 완화하기 위해 다음 조치가 적용되어 있다:

- `discord.allowedUserIds`로 봇 사용자를 제한
- `cwd.blacklist`로 민감한 디렉토리 접근 차단
- `claude.maxBudgetUsd`로 턴당 비용 제한
- `session.tokenLimit`으로 세션별 토큰 사용량 제한
- 시스템 프롬프트에서 민감 파일(.env, API 키 등) 읽기를 거부하도록 지시

**이 봇을 운영 환경에서 사용할 경우, 반드시 `allowedUserIds`를 설정하고 신뢰할 수 있는 사용자만 접근하도록 제한해야 한다.**

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
    index.ts                — 슬래시 명령어 레지스트리 & 디스패처
    start.ts                — /start
    stop.ts                 — /stop
    setCwd.ts               — /cwd (화이트/블랙리스트 검증)
  channels/
    messageSender.ts        — 2000자 분할, 파일 첨부
  interactions/
    reactionHandler.ts      — 이모지 선택지
env/                          — 환경 파일 (gitignore)
  config.yaml               — 봇 설정
  bot-state.json            — 상태 파일 (자동 생성)
env-sample/                   — 설정 예제 (git 포함)
  config.yaml               — config.yaml 샘플
```
