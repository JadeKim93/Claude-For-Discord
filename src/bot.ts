import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type Message,
  type TextChannel,
  type Guild,
} from "discord.js";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { config } from "./config.js";
import { runClaude } from "./claude.js";
import { registerSlashCommands, dispatchInteraction, generateHelpText } from "./commands/index.js";
import { sendLongMessage } from "./channels/messageSender.js";
import { handleChoices } from "./interactions/reactionHandler.js";
import type { StateManager } from "./state.js";
import type { SessionMapping } from "./types.js";

/** 구조화된 I/O 로그를 출력한다. 200자 초과 시 미리보기로 잘림. */
function logIO(direction: "IN" | "OUT", channel: string, author: string, content: string): void {
  const ts = new Date().toISOString();
  const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;
  console.log(`[${ts}] [${direction}] #${channel} @${author}: ${preview}`);
}

const ALERT_CHANNEL_NAME = "서버-알람";
const GUIDE_CHANNEL_NAME = "서버-안내";
const ADMIN_CHANNEL_NAME = "서버-관리자";

// Cached channel references
let alertChannel: TextChannel | null = null;
let adminChannel: TextChannel | null = null;

/**
 * Discord 클라이언트를 생성하고 이벤트 핸들러를 등록한다.
 * - ready: 슬래시 명령어 등록 + 시스템 채널 초기화
 * - interactionCreate: 슬래시 명령어 디스패치 (권한 검증 포함)
 * - messageCreate: 세션 채널 메시지를 Claude에 전달 (토큰 한도 체크)
 */
export function createBot(state: StateManager): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });

  client.once("ready", async () => {
    console.log(`Logged in as ${client.user?.tag}`);

    for (const guildId of config.guildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        console.error(`Guild ${guildId} not found`);
        continue;
      }

      await registerSlashCommands(guild);
      await ensureSystemChannels(guild, client);
    }
  });

  // Slash command handling
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild || !config.guildIds.includes(interaction.guild.id)) return;

    if (
      config.allowedUserIds &&
      !config.allowedUserIds.includes(interaction.user.id)
    ) {
      await interaction.reply({ content: "권한이 없습니다.", ephemeral: true });
      return;
    }

    await dispatchInteraction(interaction, state);
  });

  // Session message handling (plain messages in session channels)
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild || !config.guildIds.includes(message.guild.id)) return;

    if (
      config.allowedUserIds &&
      !config.allowedUserIds.includes(message.author.id)
    ) {
      return;
    }

    // Check if message is in a session channel
    const session = state.getSessionByChannelId(message.channel.id);
    if (session) {
      await handleSessionMessage(message, session, state);
    }
  });

  return client;
}

/** 서버-알람, 서버-안내, 서버-관리자 채널이 존재하는지 확인하고 없으면 생성한다. */
async function ensureSystemChannels(guild: Guild, client: Client): Promise<void> {
  await ensureAdminChannel(guild, client);
  await ensureAlertChannel(guild, client);
  await ensureGuideChannel(guild, client);

  // CLI 상태 점검 후 관리자/알람 채널에 보고
  const status = await checkClaudeCliStatus();
  if (status.available) {
    adminChannel?.send(`✅ Claude CLI 정상 (${status.version})`);
    alertChannel?.send("**Claude For Discord Now Online**");
  } else {
    adminChannel?.send(
      `⚠️ **Claude CLI 사용 불가**\n${status.error}\n\n` +
      `API 키 발급: https://console.anthropic.com/settings/keys\n` +
      `\`config.yaml\`의 \`claude.apiKey\` 또는 환경변수 \`ANTHROPIC_API_KEY\`를 설정한 뒤 재시작하세요.`,
    );
    alertChannel?.send("⚠️ **Claude CLI 사용 불가** — 서버-관리자 채널을 확인하세요.");
  }
}

/** 서버-관리자 채널을 확보한다. 관리자만 열람 가능. */
async function ensureAdminChannel(guild: Guild, client: Client): Promise<void> {
  let channel = guild.channels.cache.find(
    (ch) => ch.name === ADMIN_CHANNEL_NAME && ch.type === ChannelType.GuildText,
  ) as TextChannel | undefined;

  if (!channel) {
    channel = await guild.channels.create({
      name: ADMIN_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: "Claude Code Bot 관리자 채널",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: client.user!.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });
    console.log(`Created admin channel: #${ADMIN_CHANNEL_NAME}`);
  }

  adminChannel = channel;
}

/** 서버-알람 채널을 확보한다. 유저 채팅 불가. */
async function ensureAlertChannel(guild: Guild, client: Client): Promise<void> {
  let channel = guild.channels.cache.find(
    (ch) => ch.name === ALERT_CHANNEL_NAME && ch.type === ChannelType.GuildText,
  ) as TextChannel | undefined;

  if (!channel) {
    channel = await guild.channels.create({
      name: ALERT_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: "Claude Code Bot 알림 채널",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: client.user!.id,
          allow: [PermissionFlagsBits.SendMessages],
        },
      ],
    });
    console.log(`Created alert channel: #${ALERT_CHANNEL_NAME}`);
  }

  alertChannel = channel;
}

/**
 * Claude CLI 사용 가능 여부를 확인한다.
 * 1. --version으로 바이너리 존재 확인
 * 2. 간단한 프롬프트 실행으로 인증 상태 확인 (API 키 또는 OAuth)
 */
async function checkClaudeCliStatus(): Promise<{ available: boolean; version?: string; error?: string }> {
  // 1. 바이너리 존재 확인
  const version = await new Promise<string | null>((resolve) => {
    const proc = spawn(config.claudePath, ["--version"], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      resolve(code === 0 ? stdout.trim().split("\n")[0] : null);
    });
  });

  if (!version) {
    return { available: false, error: "CLI를 찾을 수 없습니다." };
  }

  // 2. 실제 실행으로 인증 확인
  const testResult = await runClaude({
    prompt: "Reply with only: ok",
    cwd: config.defaultCwd,
  }).promise;

  if (testResult.success) {
    return { available: true, version };
  }

  return { available: false, version, error: `CLI 확인됨 (${version}), 하지만 인증에 실패했습니다.\n${testResult.output}` };
}

/** 서버-안내 채널을 확보하고, 기존 메시지를 삭제한 뒤 도움말을 게시한다. */
async function ensureGuideChannel(guild: Guild, client: Client): Promise<void> {
  let channel = guild.channels.cache.find(
    (ch) => ch.name === GUIDE_CHANNEL_NAME && ch.type === ChannelType.GuildText,
  ) as TextChannel | undefined;

  if (!channel) {
    channel = await guild.channels.create({
      name: GUIDE_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: "Claude Code Bot 사용 안내",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: client.user!.id,
          allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
        },
      ],
    });
    console.log(`Created guide channel: #${GUIDE_CHANNEL_NAME}`);
  }

  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size > 0) {
      await channel.bulkDelete(messages).catch(async () => {
        for (const msg of messages.values()) {
          await msg.delete().catch(() => {});
        }
      });
    }
  } catch (err) {
    console.error("Failed to clear guide channel:", err);
  }

  await channel.send(generateHelpText());
}

/**
 * 유저 메시지를 Claude에 전달하고 응답을 채널에 전송한다.
 * promptOverride가 있으면 메시지 내용 대신 해당 텍스트를 사용 (선택지 재귀 호출용).
 *
 * 1. 타이핑 인디케이터 + ⏳ 리액션 표시
 * 2. Claude CLI 호출 (messageCount로 resume 여부 판단)
 * 3. 메시지 카운트 증가, ⏳ 제거
 * 4. 응답을 sendLongMessage로 전송
 * 5. 토큰 알림 체크
 * 6. 응답에 선택지가 있으면 리액션 추가, 선택 시 재귀 호출
 */
async function handleSessionMessage(
  message: Message,
  session: SessionMapping,
  state: StateManager,
  promptOverride?: string,
): Promise<void> {
  const channel = message.channel as TextChannel;
  const prompt = (promptOverride ?? message.content).trim();
  if (!prompt) return;

  // 1. 타이핑 + 대기 리액션
  logIO("IN", channel.name, message.author.tag, prompt);

  await channel.sendTyping();

  // 중단 버튼 + 자동 승인 토글 버튼이 달린 대기 메시지 전송
  let autoApprove = false;

  const buildWaitingRow = () =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("stop_claude")
        .setLabel("⏹ Stop")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("toggle_auto_approve")
        .setLabel(autoApprove ? "🔒 모든 요청 확인하기" : "🔓 모든 요청 허용하기")
        .setStyle(autoApprove ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );

  const waitingMsg = await message.reply({ content: "⏳ 응답을 생성하고 있습니다...", components: [buildWaitingRow()] });

  try {
    // 2. Claude SDK 호출 (권한 요청 콜백 포함)
    const isResume = session.messageCount > 0;
    const permissionRequestHandler = async (toolName: string, input: Record<string, unknown>) => {
        const ts = new Date().toISOString();
        const inputPreview = JSON.stringify(input, null, 2);
        const preview = inputPreview.length > 800
          ? inputPreview.slice(0, 800) + "\n..."
          : inputPreview;

        // 권한 요청 로깅
        const logPreview = inputPreview.length > 200 ? inputPreview.slice(0, 200) + "..." : inputPreview;
        console.log(`[${ts}] [PERM_REQ] #${channel.name}: ${toolName} - ${logPreview}`);

        // 자동 승인 모드
        if (autoApprove) {
          await channel.send({
            content: `**🔐 권한 요청: \`${toolName}\`** → ✅ 자동 허용됨\n\`\`\`json\n${preview}\n\`\`\``,
          });
          console.log(`[${ts}] [PERM_RES] #${channel.name}: ${toolName} → 자동허용`);
          return true;
        }

        // 수동 승인 모드: Discord 버튼으로 승인/거부
        const permRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("perm_allow")
            .setLabel("✅ Allow")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("perm_deny")
            .setLabel("❌ Deny")
            .setStyle(ButtonStyle.Danger),
        );

        const permMsg = await channel.send({
          content: `**🔐 권한 요청: \`${toolName}\`**\n\`\`\`json\n${preview}\n\`\`\``,
          components: [permRow],
        });

        try {
          const btnInteraction = await permMsg.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (i) => i.customId === "perm_allow" || i.customId === "perm_deny",
            time: 120_000,
          });

          const allowed = btnInteraction.customId === "perm_allow";
          await btnInteraction.update({
            content: `**🔐 권한 요청: \`${toolName}\`** → ${allowed ? "✅ 허용됨" : "❌ 거부됨"}`,
            components: [],
          });
          console.log(`[${new Date().toISOString()}] [PERM_RES] #${channel.name}: ${toolName} → ${allowed ? "허용됨" : "거부됨"}`);
          return allowed;
        } catch {
          // 타임아웃
          await permMsg.edit({
            content: `**🔐 권한 요청: \`${toolName}\`** → ⏰ 시간 초과 (거부됨)`,
            components: [],
          });
          console.log(`[${new Date().toISOString()}] [PERM_RES] #${channel.name}: ${toolName} → 시간초과`);
          return false;
        }
      };
    const handle = runClaude({
      prompt,
      sessionId: session.sessionId,
      isResume,
      cwd: session.projectPath,
      onPermissionRequest: permissionRequestHandler,
    });

    // Stop 버튼 클릭 감지
    let stopped = false;
    const stopCollector = waitingMsg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === "stop_claude",
    }).then(async (btnInteraction) => {
      stopped = true;
      handle.abort();
      await btnInteraction.update({ content: "⏹ 응답이 중단되었습니다.", components: [] });
    }).catch(() => {});

    // 자동 승인 토글 버튼 collector
    const toggleCollector = waitingMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === "toggle_auto_approve",
    });
    toggleCollector.on("collect", async (btnInteraction) => {
      autoApprove = !autoApprove;
      await btnInteraction.update({ components: [buildWaitingRow()] });
    });

    // 3. Claude 응답 대기
    let result = await handle.promise;

    // 3-1. resume 실패 시 새 세션으로 자동 재시도
    if (!result.success && isResume) {
      console.log(`[RESUME_FAIL] #${channel.name}: session ${session.sessionId.slice(0, 8)} resume 실패, 새 세션으로 재시도`);
      const newSessionId = randomUUID();
      state.resetSession(session.channelId, newSessionId);
      await channel.send(`⚠️ 기존 세션 복원에 실패하여 새 세션으로 재시작합니다. (\`${newSessionId.slice(0, 8)}\`)`);

      const retryHandle = runClaude({
        prompt,
        sessionId: newSessionId,
        isResume: false,
        cwd: session.projectPath,
        onPermissionRequest: permissionRequestHandler,
      });
      result = await retryHandle.promise;
    }

    // 토글 collector 정리
    toggleCollector.stop();

    if (stopped) return;

    // 4. 대기 메시지 삭제
    await waitingMsg.delete().catch(() => {});
    void stopCollector;

    // 5. 메시지 카운트 증가
    const currentSession = state.getSessionByChannelId(session.channelId);
    state.updateSessionMessageCount(
      session.channelId,
      (currentSession?.messageCount ?? 0) + 1,
    );

    const response = result.success
      ? result.output
      : `Error: ${result.output}`;

    logIO("OUT", channel.name, "Claude", response);

    // 6. thinking 블록이 있으면 별도 메시지로 전송
    if (result.thinking) {
      const thinkingText = result.thinking.length > 1900
        ? result.thinking.slice(0, 1900) + "..."
        : result.thinking;
      await channel.send({
        content: `> **Thinking**\n${thinkingText.split("\n").map(l => `> ${l}`).join("\n")}`,
        flags: [MessageFlags.SuppressEmbeds],
      });
    }

    // 7. 응답을 새 메시지로 전송
    let sentMessages: Message[];
    if (response.length <= 2000) {
      const msg = await channel.send({ content: response, flags: [MessageFlags.SuppressEmbeds] });
      sentMessages = [msg];
    } else {
      sentMessages = await sendLongMessage(channel, response, {
        replyTo: message,
      });
    }

    // 8. 선택지 감지 → 버튼 추가 → 선택 시 재귀 호출
    if (result.success) {
      const lastMsg = sentMessages[sentMessages.length - 1];
      const choice = await handleChoices(response, lastMsg);
      if (choice) {
        await handleSessionMessage(
          message,
          state.getSessionByChannelId(session.channelId)!,
          state,
          choice,
        );
      }
    }
  } catch (err) {
    await waitingMsg.delete().catch(() => {});
    await channel.send("❌ 오류가 발생했습니다.").catch(() => {});
    console.error("Error handling session message:", err);
  }
}
