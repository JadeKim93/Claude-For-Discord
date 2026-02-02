import { AttachmentBuilder, MessageFlags, type Message, type TextChannel } from "discord.js";

const MAX_LENGTH = 2000;

/**
 * 응답 길이에 따라 전송 방식을 분기한다.
 * - 2000자 이하: 단일 메시지
 * - 6000자 이하: 줄바꿈/공백 기준으로 분할 전송
 * - 6000자 초과: 미리보기 + response.md 파일 첨부
 */
export async function sendLongMessage(
  channel: TextChannel,
  content: string,
  options?: { replyTo?: Message },
): Promise<Message[]> {
  if (content.length <= MAX_LENGTH) {
    const msg = options?.replyTo
      ? await options.replyTo.reply({ content, flags: [MessageFlags.SuppressEmbeds] })
      : await channel.send({ content, flags: [MessageFlags.SuppressEmbeds] });
    return [msg];
  }

  if (content.length <= 6000) {
    return sendSplitMessages(channel, content, options);
  }

  const preview = content.slice(0, MAX_LENGTH - 60) + "\n\n... (full response attached)";
  const file = new AttachmentBuilder(Buffer.from(content, "utf-8"), {
    name: "response.md",
  });

  const msg = options?.replyTo
    ? await options.replyTo.reply({ content: preview, files: [file], flags: [MessageFlags.SuppressEmbeds] })
    : await channel.send({ content: preview, files: [file], flags: [MessageFlags.SuppressEmbeds] });
  return [msg];
}

/** 긴 텍스트를 MAX_LENGTH 이하 청크로 분할하여 순차 전송한다. 줄바꿈 → 공백 → 강제 절단 순으로 분할점을 탐색. */
async function sendSplitMessages(
  channel: TextChannel,
  content: string,
  options?: { replyTo?: Message },
): Promise<Message[]> {
  const messages: Message[] = [];
  let remaining = content;
  let isFirst = true;

  while (remaining.length > 0) {
    let chunk: string;
    if (remaining.length <= MAX_LENGTH) {
      chunk = remaining;
      remaining = "";
    } else {
      let splitIdx = remaining.lastIndexOf("\n", MAX_LENGTH);
      if (splitIdx < MAX_LENGTH * 0.3) {
        splitIdx = remaining.lastIndexOf(" ", MAX_LENGTH);
      }
      if (splitIdx < MAX_LENGTH * 0.3) {
        splitIdx = MAX_LENGTH;
      }
      chunk = remaining.slice(0, splitIdx);
      remaining = remaining.slice(splitIdx).trimStart();
    }

    const msg =
      isFirst && options?.replyTo
        ? await options.replyTo.reply({ content: chunk, flags: [MessageFlags.SuppressEmbeds] })
        : await channel.send({ content: chunk, flags: [MessageFlags.SuppressEmbeds] });
    messages.push(msg);
    isFirst = false;
  }

  return messages;
}
