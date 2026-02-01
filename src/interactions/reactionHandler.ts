import type { Message } from "discord.js";

const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const REACTION_TIMEOUT = 120_000;

// Matches: "1. text", "1) text", "**1.** text", "**1)** text", "- 1. text"
const NUMBERED_LINE =
  /^\s*(?:[-*]\s*)?(?:\*{0,2})(\d+)[.)]\*{0,2}\s+(.+)$/;

/**
 * Claude 응답에서 번호 선택지를 감지하고 이모지 리액션으로 유저 선택을 받는다.
 * 1. parseChoices로 마지막 연속 번호 블록 추출
 * 2. 응답 메시지에 숫자 이모지 리액션 추가
 * 3. 유저가 리액션을 누르면 해당 선택지 텍스트를 반환
 * 4. 타임아웃 시 메시지에 "선택 시간 초과"를 편집으로 기록
 */
export async function handleChoices(
  responseText: string,
  responseMsg: Message,
): Promise<string | null> {
  const choices = parseChoices(responseText);

  if (choices.length < 2 || choices.length > 9) {
    return null;
  }

  console.log(`[Choices] Found ${choices.length} choices:`, choices);

  // Add emoji reactions directly to the response message
  for (let i = 0; i < choices.length; i++) {
    try {
      await responseMsg.react(NUMBER_EMOJIS[i]);
    } catch (err) {
      console.error(`[Choices] Failed to add reaction ${i}:`, err);
    }
  }

  // Wait for a user to react (count becomes 2: bot + user)
  try {
    const collected = await responseMsg.awaitReactions({
      filter: (reaction) => {
        const emoji = reaction.emoji.name;
        if (!emoji) return false;
        if (!NUMBER_EMOJIS.slice(0, choices.length).includes(emoji)) return false;
        return (reaction.count ?? 0) >= 2;
      },
      max: 1,
      time: REACTION_TIMEOUT,
    });

    const reaction = collected.first();
    if (!reaction) {
      await responseMsg.edit(`${responseMsg.content}\n\n⏰ 선택 시간 초과`).catch(() => {});
      await responseMsg.reactions.removeAll().catch(() => {});
      return null;
    }

    const idx = NUMBER_EMOJIS.indexOf(reaction.emoji.name!);
    if (idx < 0 || idx >= choices.length) return null;

    await responseMsg.edit(`${responseMsg.content}\n\n**선택:** ${NUMBER_EMOJIS[idx]} ${choices[idx]}`).catch(() => {});
    await responseMsg.reactions.removeAll().catch(() => {});

    return choices[idx];
  } catch {
    await responseMsg.edit(`${responseMsg.content}\n\n⏰ 선택 시간 초과`).catch(() => {});
    await responseMsg.reactions.removeAll().catch(() => {});
    return null;
  }
}

/**
 * 텍스트에서 마지막 연속 번호 블록을 파싱하여 선택지 배열로 반환한다.
 * "1. ...", "2) ..." 등의 패턴을 인식하며, 번호가 끊기면 새 블록으로 처리.
 */
function parseChoices(text: string): string[] {
  const lines = text.split("\n");

  const blocks: string[][] = [];
  let currentBlock: string[] = [];
  let expectedNum = 1;

  for (const line of lines) {
    const match = line.match(NUMBERED_LINE);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num === expectedNum) {
        currentBlock.push(match[2].trim());
        expectedNum++;
      } else if (num === 1) {
        if (currentBlock.length >= 2) blocks.push([...currentBlock]);
        currentBlock = [match[2].trim()];
        expectedNum = 2;
      } else {
        if (currentBlock.length >= 2) blocks.push([...currentBlock]);
        currentBlock = [];
        expectedNum = 1;
      }
    } else {
      if (line.trim() === "" && currentBlock.length > 0) {
        continue;
      }
      if (currentBlock.length >= 2) blocks.push([...currentBlock]);
      currentBlock = [];
      expectedNum = 1;
    }
  }
  if (currentBlock.length >= 2) blocks.push([...currentBlock]);

  return blocks.length > 0 ? blocks[blocks.length - 1] : [];
}
