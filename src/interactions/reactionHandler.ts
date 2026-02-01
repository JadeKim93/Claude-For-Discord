import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import type { Message } from "discord.js";

const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const CHOICE_TIMEOUT = 120_000;
const BUTTON_LABEL_MAX = 80;

// Matches: "1. text", "1) text", "**1.** text", "**1)** text", "- 1. text"
const NUMBERED_LINE =
  /^\s*(?:[-*]\s*)?(?:\*{0,2})(\d+)[.)]\*{0,2}\s+(.+)$/;

/**
 * Claude 응답에서 번호 선택지를 감지하고 버튼으로 유저 선택을 받는다.
 * 1. parseChoices로 마지막 연속 번호 블록 추출
 * 2. 응답 메시지를 편집하여 버튼 추가
 * 3. 유저가 버튼을 누르면 해당 선택지 텍스트를 반환
 * 4. 타임아웃 시 버튼을 제거하고 "선택 시간 초과"를 기록
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

  // 버튼 생성 (한 행에 최대 5개)
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < choices.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    const slice = choices.slice(i, i + 5);
    for (let j = 0; j < slice.length; j++) {
      const idx = i + j;
      const label =
        slice[j].length > BUTTON_LABEL_MAX
          ? slice[j].slice(0, BUTTON_LABEL_MAX - 1) + "…"
          : slice[j];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`choice_${idx}`)
          .setLabel(`${NUMBER_EMOJIS[idx]}`)
          .setStyle(ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }

  // 기존 메시지에 버튼 추가
  try {
    await responseMsg.edit({ components: rows });
  } catch (err) {
    console.error("[Choices] Failed to add buttons:", err);
    return null;
  }

  // 버튼 클릭 대기
  try {
    const btnInteraction = await responseMsg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.customId.startsWith("choice_"),
      time: CHOICE_TIMEOUT,
    });

    const idx = parseInt(btnInteraction.customId.replace("choice_", ""), 10);
    if (idx < 0 || idx >= choices.length) return null;

    await btnInteraction.update({
      content: `${responseMsg.content}\n\n**선택:** ${NUMBER_EMOJIS[idx]} ${choices[idx]}`,
      components: [],
    });

    return choices[idx];
  } catch {
    // 타임아웃
    await responseMsg
      .edit({
        content: `${responseMsg.content}\n\n⏰ 선택 시간 초과`,
        components: [],
      })
      .catch(() => {});
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
