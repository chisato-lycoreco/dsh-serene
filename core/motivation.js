/**
 * core/motivation.js — 主动性（纯函数）
 *
 * 回答的不是「隔多久」，是「这一次该不该开口」。
 *
 * 0.1.x 只给了 proactiveGap（12–75 分钟的间隔），但间隔是回答「大概多久」，
 * 不是回答「现在可不可以」。真正的病在别处：门越多，她越安静；安静久了，
 * 「不说」会自增成习惯——172 次决策里 171 次选择不说，那不是克制，是不在场。
 *
 * 所以这里只做三件事：
 *   1. 一个预算：每天几次、两次之间多久（额度、周期、优先级、例外）；
 *   2. 一个可回收的 hold：「我想说，但这次不说」，20 分钟内线性退掉，绝不累积；
 *   3. 一个替代：不说之后至少做一件事，而不是什么都不发生。
 *
 * 全部确定性：不掷骰子、不看系统时钟（时间从参数进），同样的输入同样的结果。
 */

import { normalizeLayers, proactiveGap } from "./emotion.js";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** 打扰预算。四个数一起改，别只改其中一个。 */
export const PROACTIVE = Object.freeze({
  /** 每天最多主动开口几次。 */
  perDay: 3,
  /** 两次主动之间至少隔多久。 */
  minGapMinutes: 60,
  /** hold 的有效期：20 分钟内线性退掉，不能永不过期。 */
  holdMinutes: 20,
  /** 被拒绝之后的冷却。 */
  cooldownMinutes: 30,
  /** 他刚说完话的 10 分钟里，先接话，不另起话头。 */
  justSpokeMinutes: 10,
  /** 安静时段（北京时间）：23:00–08:00，只留给约好的事。 */
  quietStart: 23,
  quietEnd: 8,
  /** 意图强度低于这个值，就只是「没什么想说的」，不记 hold。 */
  minIntent: 0.45,
  /** 决策节拍：20 分钟想一次。 */
  cadenceMinutes: 20,
});

const QUIET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
});

/** 北京时间的日期键（预算按这一天算）。 */
export function beijingDateKey(ts) {
  const parts = Object.fromEntries(QUIET_FORMAT.formatToParts(new Date(ts)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 北京时间的钟点（0–23）。 */
export function beijingHour(ts) {
  const parts = Object.fromEntries(QUIET_FORMAT.formatToParts(new Date(ts)).map((part) => [part.type, part.value]));
  return Number(parts.hour) % 24;
}

export function isQuietHour(hour) {
  return hour >= PROACTIVE.quietStart || hour < PROACTIVE.quietEnd;
}

/**
 * 意图强度：她有多想说。
 *
 *   0.45 ×「连接感低」 + 0.20 ×「有点闷」 + 0.35 ×「隔了多久」
 *
 * 刚聊完几乎为 0；隔了一天、连接感偏低时会自己涨上来。
 * 这不是概率——它是要不要开口的「冲动」，后面还要过预算和 hold。
 */
export function intent(layers, { now = Date.now(), lastInteractionAt = 0 } = {}) {
  const normalized = normalizeLayers(layers);
  const connection = Number(normalized.social.connection ?? 60);
  const pleasure = Number(normalized.primary.pleasure ?? 64);
  const hours = Number(lastInteractionAt) > 0 ? Math.max(0, now - Number(lastInteractionAt)) / HOUR : 24;
  const want = clamp01((70 - connection) / 30);
  const flat = clamp01((68 - pleasure) / 34);
  const absent = clamp01(hours / 24);
  return round(0.45 * want + 0.2 * flat + 0.35 * absent, 3);
}

/** 状态归一化：跨天清零、hold 过期丢掉、字段收敛。 */
export function normalizeState(input = {}, { now = Date.now() } = {}) {
  const today = beijingDateKey(now);
  const saved = input?.today;
  const hold = input?.hold;
  const expiresAt = Number(hold?.expiresAt) || 0;
  return {
    version: 1,
    lastProactiveAt: Number(input?.lastProactiveAt) || 0,
    today: {
      date: today,
      count: saved?.date === today ? Math.max(0, Math.floor(Number(saved.count) || 0)) : 0,
    },
    hold:
      hold && expiresAt > now
        ? { reason: String(hold.reason ?? ""), why: String(hold.why ?? ""), at: Number(hold.at) || now, expiresAt }
        : null,
    cooldownUntil: Math.max(0, Number(input?.cooldownUntil) || 0),
  };
}

/** 不说之后至少做一件事——四选一，按不说原因给。 */
export function substituteFor(reason) {
  switch (reason) {
    case "just_spoke":
      return "把想说的那句先记下来，等他说完再接";
    case "cooldown":
      return "不追问；做点自己的事，过半小时再说";
    case "gap":
      return "留个痕迹就够了：记一笔、写一句，不推到他面前";
    default:
      return "靠近一点，别开口";
  }
}

/**
 * 这一次该不该开口。
 *
 * @param {{now?: number, layers?: object, lastInteractionAt?: number, asleep?: boolean, state?: object, policy?: object}} input
 * @returns {{
 *   act: boolean, reason: string, why: string, intent: number,
 *   budget: {date: string, used: number, limit: number, remaining: number},
 *   hold: {reason: string, why: string, at: number, expiresAt: number, remainingMinutes: number, decay: number} | null,
 *   substitute: string | null, nextCheckAt: number | null, urgeMs: number
 * }}
 */
export function decide({
  now = Date.now(),
  layers = {},
  lastInteractionAt = 0,
  asleep = false,
  state = {},
  policy = PROACTIVE,
} = {}) {
  const normalized = normalizeState(state, { now });
  const desire = intent(layers, { now, lastInteractionAt });
  const used = normalized.today.count;
  const budget = {
    date: normalized.today.date,
    used,
    limit: policy.perDay,
    remaining: Math.max(0, policy.perDay - used),
  };
  const base = {
    act: false,
    reason: "ok",
    why: "",
    intent: desire,
    budget,
    hold: null,
    substitute: null,
    nextCheckAt: null,
    urgeMs: proactiveGap(layers),
  };

  // 1. 状态层面：睡着、深夜。这两条不问意图，也不记 hold。
  if (asleep) return { ...base, reason: "asleep", why: "她睡着了" };
  if (isQuietHour(beijingHour(now))) return { ...base, reason: "quiet", why: "这个点不该打扰" };

  // 2. 没有冲动：不是克制，是现在真的没什么想说。
  if (desire < policy.minIntent) return { ...base, reason: "no_intent", why: "现在没什么想说的" };

  // 3. 预算用完：这是硬停止，不进入 hold——否则一天都在「想说不说」。
  if (used >= policy.perDay) return { ...base, reason: "budget", why: "今天的额度用完了" };

  // 4. 还没退掉的 hold：这次就是不说，等它自己过期。
  if (normalized.hold) {
    const remainMs = Math.max(0, normalized.hold.expiresAt - now);
    return {
      ...base,
      reason: "holding",
      why: normalized.hold.why || "刚才决定先不说",
      hold: {
        ...normalized.hold,
        remainingMinutes: Math.round(remainMs / MINUTE),
        decay: round(remainMs / (policy.holdMinutes * MINUTE), 3),
      },
      substitute: substituteFor(normalized.hold.reason),
      nextCheckAt: normalized.hold.expiresAt,
    };
  }

  // 5. 剩下的都是「想说，但这会儿不合适」：记一次可回收的 hold。
  const holdFor = (reason, why) => ({
    ...base,
    reason,
    why,
    hold: {
      reason,
      why,
      at: now,
      expiresAt: now + policy.holdMinutes * MINUTE,
      remainingMinutes: policy.holdMinutes,
      decay: 1,
    },
    substitute: substituteFor(reason),
    nextCheckAt: now + policy.holdMinutes * MINUTE,
  });

  if (Number(lastInteractionAt) > 0 && now - Number(lastInteractionAt) < policy.justSpokeMinutes * MINUTE) {
    return holdFor("just_spoke", "他刚说完，先接他的话");
  }
  if (normalized.cooldownUntil > now) {
    return holdFor("cooldown", "刚被拒过，先不凑上去");
  }
  if (normalized.lastProactiveAt > 0 && now - normalized.lastProactiveAt < policy.minGapMinutes * MINUTE) {
    return holdFor("gap", "上一次开口还没过多久");
  }

  return {
    ...base,
    act: true,
    reason: "ok",
    why: "想说话，这会儿也合适",
    nextCheckAt: now + policy.cadenceMinutes * MINUTE,
  };
}

/** 她真的开口了：走完一次预算，清掉 hold。 */
export function commit(state = {}, { now = Date.now() } = {}) {
  const normalized = normalizeState(state, { now });
  return {
    ...normalized,
    lastProactiveAt: now,
    today: { date: normalized.today.date, count: normalized.today.count + 1 },
    hold: null,
    cooldownUntil: 0,
  };
}

/** 被拒绝了：也算开过口（预算要扣），另记一段冷却。 */
export function reject(state = {}, { now = Date.now(), policy = PROACTIVE } = {}) {
  const next = commit(state, { now });
  return { ...next, cooldownUntil: now + policy.cooldownMinutes * MINUTE };
}

/** 调试用：把决策讲成一行。 */
export function describeDecision(decision) {
  if (decision.act) return "现在可以开口。";
  const scope = decision.hold ? `，${decision.hold.remainingMinutes} 分钟后回收` : "";
  const replace = decision.substitute ? `；替代动作：${decision.substitute}` : "";
  return `先不说：${decision.why}${scope}${replace}。`;
}

export { HOUR, MINUTE };
