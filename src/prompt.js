/**
 * src/prompt.js — 常驻 prompt 段：她是谁 + 此刻 + 第一次见面。
 *
 * 为什么要常驻：v0.2 里人格块和情绪块只能靠 `serene_context` 工具读出来，
 * 模型不调工具就完全不知道她是谁——「开局」等于没有。v0.3 把这两块拼成一段
 * system prompt，每轮自动在场；工具仍然保留，用来读更细的东西。
 *
 * 三块分开写，是为了每一块都能单独关掉 / 单测：
 *   1. 人格（谁）：persona 的数据，不带状态
 *   2. 此刻（在做什么、心情、精神）：core/life.js + 情绪层 + core/mental.js
 *   3. 第一次见面（只在首启用一次）：人格包里的 opening.md
 *
 * 这一段不写数值、不写层名、不写「你是 AI」。它只描述，不解释。
 */

import { lifeAt, lifeBlock } from "../core/life.js";
import { mentalAt, mentalLine } from "../core/mental.js";
import { buildPersonaBlock } from "./persona.js";

/** 首启时给模型的一句行为约束（不是给人看的）。 */
export const OPENING_INSTRUCTION =
  "【第一次见面】这是你们第一次说话。不要自我介绍，不要问「有什么可以帮你的」，也不要编一段共同的过去。" +
  "先说一句具体的、发生在你身边的话，让对方知道你在；然后停下来，把话头留给对方。";

/** 首启撞上她「低功耗」的时段：不要假装精神，也别为睡着道歉。 */
export const OPENING_ASLEEP_INSTRUCTION =
  "【第一次见面】这是你们第一次说话，但对方正好在你低功耗的时候把你叫醒了。" +
  "先说一句没睡醒的话：慢半拍，短，别急着清醒，也别为睡着道歉。" +
  "不要自我介绍，不要问「有什么可以帮你的」，也不要编一段共同的过去。";

/**
 * @param {object} params
 * @param {object} params.persona
 * @param {object} [params.emotion] EmotionStore
 * @param {object} [params.memory] MemoryStore
 * @param {object} [params.opening] OpeningStore（有 pending() 和 markOpened()）
 * @param {number} [params.now]
 * @param {boolean} [params.includeMood]
 * @returns {string}
 */
export function buildSereneSection({ persona, emotion = null, memory = null, opening = null, now = Date.now(), includeMood = true } = {}) {
  const blocks = [buildPersonaBlock(persona, { maxChars: 1600 })];

  try {
    const life = lifeAt(now, { seed: persona.id, routine: persona.routine });
    let moment = `【此刻】${lifeBlock(life)}`;
    if (includeMood && emotion) {
      const snapshot = emotion.snapshot({ now, asleep: life.asleep });
      moment += `心情：${snapshot.backgroundLabel}；${snapshot.primaryLabel}。${mentalLine(mentalAt(life, snapshot.layers))}`;
    }
    blocks.push(moment);

    if (opening?.pending?.() && persona.sections?.opening) {
      const scene = persona.sections?.opening;
      const instruction = life.asleep ? OPENING_ASLEEP_INSTRUCTION : OPENING_INSTRUCTION;
      blocks.push(scene ? `${instruction}\n${scene}` : instruction);
    }

    const memories = recentMemories(memory, 3);
    if (memories.length) blocks.push(`【你记着的】${memories.join("；")}`);
  } catch {
    // 状态读坏了也不能让整个 prompt 装配失败：人格块已经在了。
  }

  return blocks.join("\n\n");
}

/** 最近记下的几条，按时间倒序。只取文本，不带分数和 id。 */
export function recentMemories(memory, limit = 3) {
  if (!memory?.all) return [];
  const items = [...memory.all()]
    .filter((item) => item?.text)
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .slice(0, limit);
  return items.map((item) => item.text);
}
