/**
 * core/mental.js — 精神状态（纯函数）
 *
 * 和情绪层分工不同：
 *   - 情绪回答「她此刻高不高兴」；
 *   - 精神回答「她此刻转不转得动」。
 *
 * 所以这里不持久化、不留疤、不衰减：它全部从**作息**（core/life.js）
 * 和**情绪层**当场算出来。同一时刻、同样的状态，永远得到同样的答案。
 *
 * 三个维度：
 *   energy  精力（跟着作息走；人格可以在 routine 的槽位里直接给 energy）
 *   focus   专注（精力 × 不被心里的事打断）
 *   tension 紧（唤醒高、愉悦低的时候上来）
 */

import { energyAt } from "./life.js";

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/**
 * @param {ReturnType<import("./life.js").lifeAt>} life
 * @param {{primary?: object, background?: object}|null} layers 情绪层的三层
 */
export function mentalAt(life, layers = null) {
  const energy = clamp01(life?.asleep ? 0.15 : energyAt(life));
  const primary = layers?.primary ?? {};
  const background = layers?.background ?? {};
  const arousal = Number(primary.arousal ?? 50);
  const pleasure = Number(primary.pleasure ?? background.pleasure ?? 60);
  const tension = clamp01((arousal - 55) / 70 + (60 - pleasure) / 90);
  const focus = clamp01(energy * (0.55 + (life?.phase === "work" ? 0.25 : 0)) * (1 - tension * 0.45) + 0.15);
  return {
    energy: round2(energy),
    focus: round2(focus),
    tension: round2(tension),
    label: labelFor({ energy, focus, tension }),
  };
}

/** 只想拿一句话时用它。 */
export function mentalLine(mental) {
  return mental?.label ? `精神上${mental.label}。` : "";
}

function labelFor({ energy, focus, tension }) {
  const parts = [];
  if (tension >= 0.6) parts.push("有点紧");
  if (energy <= 0.3) parts.push("有点困");
  else if (energy >= 0.85 && tension < 0.45) parts.push("挺足");
  if (focus <= 0.35 && parts.length < 2) parts.push("有点走神");
  if (!parts.length) parts.push("还行");
  return parts.join("，");
}

const round2 = (value) => Math.round(value * 100) / 100;
