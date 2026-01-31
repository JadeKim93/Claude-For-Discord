import type { Message } from "discord.js";

const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const REACTION_TIMEOUT = 120_000;

// Matches: "1. text", "1) text", "**1.** text", "**1)** text", "- 1. text"
const NUMBERED_LINE =
  /^\s*(?:[-*]\s*)?(?:\*{0,2})(\d+)[.)]\*{0,2}\s+(.+)$/;

/**
 * Detect numbered choices in Claude's response, add emoji reactions
 * to the response message, and wait for user selection.
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
 * Parse numbered choices from the LAST contiguous numbered block in the text.
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
