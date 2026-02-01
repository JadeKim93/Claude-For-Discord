import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  type Message,
  type TextChannel,
  type Guild,
} from "discord.js";
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
  });

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
  await message.react("⏳");

  try {
    // 2. Claude CLI 호출
    const isResume = session.messageCount > 0;
    const result = await runClaude({
      prompt,
      sessionId: session.sessionId,
      isResume,
      cwd: session.projectPath,
    });

    // 3. 메시지 카운트 증가, ⏳ 제거
    state.updateSessionMessageCount(
      session.channelId,
      session.messageCount + 1,
    );

    await message.reactions.removeAll().catch(() => {});

    const response = result.success
      ? result.output
      : `Error: ${result.output}`;

    // 4. 응답 전송
    logIO("OUT", channel.name, "Claude", response);

    const sentMessages = await sendLongMessage(channel, response, {
      replyTo: message,
    });

    // 5. 선택지 감지 → 리액션 추가 → 선택 시 재귀 호출
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
    await message.reactions.removeAll().catch(() => {});
    await message.react("❌");
    console.error("Error handling session message:", err);
  }
}
