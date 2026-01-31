import { AttachmentBuilder, type Message, type TextChannel } from "discord.js";

const MAX_LENGTH = 2000;

export async function sendLongMessage(
  channel: TextChannel,
  content: string,
  options?: { replyTo?: Message },
): Promise<Message[]> {
  if (content.length <= MAX_LENGTH) {
    const msg = options?.replyTo
      ? await options.replyTo.reply(content)
      : await channel.send(content);
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
    ? await options.replyTo.reply({ content: preview, files: [file] })
    : await channel.send({ content: preview, files: [file] });
  return [msg];
}

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
        ? await options.replyTo.reply(chunk)
        : await channel.send(chunk);
    messages.push(msg);
    isFirst = false;
  }

  return messages;
}
