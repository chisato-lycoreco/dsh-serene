/**
 * core/life.js — 她自己的日子（纯函数）
 *
 * 这是「开局」的地基：她第一句话不该是「你好，有什么可以帮你」，
 * 而是「这个点我刚把碗洗完」——而且这句话必须是从**真实时间**算出来的，
 * 不是从一张写死的日程表里抄的。
 *
 * 同一时刻永远得到同样的结果：
 *   - 时段表按工作日 / 周末分两套；
 *   - 同一时段有几种可能（在看书 / 在听歌 / 在收拾），用当天日期做种子选一种，
 *     所以今天和明天不一样，但今天重跑一百次都一样；
 *   - 不读系统时区，统一按北京时间（和情绪层的昼夜节律同一把尺子）。
 *
 * 这里只有「她在做什么」，没有「她怎么想」——后者是情绪层和精神状态的事。
 */

import { beijingMinuteOfDay } from "./emotion.js";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" });
const DAY = 86_400_000;

/** 00:00 起的分钟数 → "周六" / "周五"。 */
export function weekdayOf(ts) {
  const label = WEEKDAY.format(new Date(ts));
  return { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" }[label] ?? "";
}

export function dayKeyOf(ts) {
  const minute = beijingMinuteOfDay(ts);
  const midnight = ts - minute * 60_000;
  return `${weekdayOf(ts)}-${new Date(midnight + 8 * 3_600_000).toISOString().slice(0, 10)}`;
}

/** FNV-1a：只要稳定，不求均匀。 */
function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

const pick = (list, seed) => list[hash(seed) % list.length];

/**
 * 时段表。`from`/`to` 是当天第几分钟，`to` 独占。
 * variants 是同一时段的几种过法；只有一种时不用种子。
 */
export const DEFAULT_WEEKDAY_SLOTS = [  { from: 0, to: 400, phase: "sleep", place: "床上", asleep: true, variants: ["睡着"] },
  { from: 400, to: 440, phase: "morning", place: "床上", variants: ["刚醒，还赖着", "醒了但没起", "在摸手机"] },
  { from: 440, to: 480, phase: "morning", place: "洗手间", variants: ["在洗漱", "刚洗完脸"] },
  { from: 480, to: 510, phase: "morning", place: "厨房", variants: ["在弄早饭", "在吃早饭"] },
  { from: 510, to: 540, phase: "commute", place: "路上", variants: ["在出门的路上", "刚收拾完，准备走"] },
  { from: 540, to: 720, phase: "work", place: "桌前", variants: ["在写东西", "在看资料", "在回消息"] },
  { from: 720, to: 780, phase: "meal", place: "厨房", variants: ["在弄午饭", "在吃午饭"] },
  { from: 780, to: 810, phase: "break", place: "楼下", variants: ["在楼下走一圈", "在外面晒太阳"] },
  { from: 810, to: 1080, phase: "work", place: "桌前", variants: ["在做事", "在看东西", "在收尾"] },
  { from: 1080, to: 1140, phase: "meal", place: "厨房", variants: ["在做饭", "在吃晚饭"] },
  { from: 1140, to: 1350, phase: "own", place: "屋里", variants: ["在看书", "在听歌", "在收拾屋子", "在发呆", "刚下楼走了走"] },
  { from: 1350, to: 1410, phase: "night", place: "洗手间", variants: ["在洗漱", "刚洗完澡"] },
  { from: 1410, to: 1440, phase: "night", place: "床上", variants: ["躺着，还没睡", "在看手机"] },
];

export const DEFAULT_WEEKEND_SLOTS = [
  { from: 0, to: 510, phase: "sleep", place: "床上", asleep: true, variants: ["睡着"] },
  { from: 510, to: 570, phase: "morning", place: "床上", variants: ["赖床", "醒了，没起", "在摸手机"] },
  { from: 570, to: 630, phase: "morning", place: "厨房", variants: ["在弄早饭", "在吃早饭"] },
  { from: 630, to: 720, phase: "chores", place: "屋里", variants: ["在洗衣服", "在收拾屋子", "在买菜"] },
  { from: 720, to: 810, phase: "meal", place: "厨房", variants: ["在做饭", "在吃午饭"] },
  { from: 810, to: 1050, phase: "own", place: "外面", variants: ["出门了", "在书店", "在咖啡店坐着", "在家看剧"] },
  { from: 1050, to: 1140, phase: "meal", place: "厨房", variants: ["在做饭", "在吃晚饭"] },
  { from: 1140, to: 1380, phase: "own", place: "屋里", variants: ["在看书", "在听歌", "在看电影", "在收拾", "在发呆"] },
  { from: 1380, to: 1440, phase: "night", place: "床上", variants: ["躺着，还没睡", "刚洗漱完"] },
];

/**
 * 人格可以带自己的作息表（`persona.json` 的 `routine`）。
 *
 * 不带的沿用上面这张「普通人的一天」。带了的必须给全（weekday / weekend），
 * 缺一边就用默认补——不让人格因为漏了一行而在半夜失去作息。
 *
 * 槽位形状：{ from, to, phase?, place?, asleep?, variants: string[] }
 * from / to 是当天第几分钟，to 独占。
 */
export function normalizeRoutine(routine) {
  const weekday = normalizeSlots(routine?.weekday);
  const weekend = normalizeSlots(routine?.weekend);
  return {
    weekday: weekday.length ? weekday : DEFAULT_WEEKDAY_SLOTS,
    weekend: weekend.length ? weekend : DEFAULT_WEEKEND_SLOTS,
  };
}

function normalizeSlots(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((slot) => {
      const from = Math.max(0, Math.min(1439, Math.floor(Number(slot?.from))));
      const to = Math.max(from + 1, Math.min(1440, Math.floor(Number(slot?.to))));
      const variants = (Array.isArray(slot?.variants) ? slot.variants : [])
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean);
      if (!Number.isFinite(from) || !Number.isFinite(to) || !variants.length) return null;
      const energy = Number(slot?.energy);
      return {
        from,
        to,
        phase: String(slot?.phase ?? "own").trim() || "own",
        place: String(slot?.place ?? "屋里").trim() || "屋里",
        asleep: Boolean(slot?.asleep),
        energy: Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : null,
        variants,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.from - b.from);
}

/** 她此刻在做什么。 */
export function lifeAt(ts = Date.now(), { seed = "serene", routine = null } = {}) {
  const minute = beijingMinuteOfDay(ts);
  const weekday = weekdayOf(ts);
  const weekend = weekday === "周六" || weekday === "周日";
  const schedule = normalizeRoutine(routine);
  const slots = weekend ? schedule.weekend : schedule.weekday;
  const slot = slots.find((item) => minute >= item.from && minute < item.to) ?? slots[slots.length - 1];
  const key = dayKeyOf(ts);
  const activity = slot.variants.length === 1
    ? slot.variants[0]
    : pick(slot.variants, `${seed}:${key}:${slot.from}`);
  return {
    ts,
    minute,
    key,
    weekday: weekdayOf(ts),
    weekend,
    phase: slot.phase,
    place: slot.place,
    activity,
    asleep: Boolean(slot.asleep),
    energy: Number.isFinite(slot.energy) ? slot.energy : null,
    since: ts - (minute - slot.from) * 60_000,
    until: ts + (slot.to - minute) * 60_000,
  };
}

/** 一天的时间线，给 demo 和「她今天怎么过」用。 */
export function dayTimeline(ts = Date.now(), { routine = null } = {}) {
  const minute = beijingMinuteOfDay(ts);
  const start = ts - minute * 60_000;
  const schedule = normalizeRoutine(routine);
  const slots = lifeAt(start + 1, { routine: schedule }).weekend ? schedule.weekend : schedule.weekday;
  return slots.map((slot) => ({
    from: start + slot.from * 60_000,
    to: start + Math.min(slot.to, 1440) * 60_000,
    phase: slot.phase,
    place: slot.place,
    asleep: Boolean(slot.asleep),
    activity: slot.variants.length === 1 ? slot.variants[0] : pick(slot.variants, `serene:${dayKeyOf(ts)}:${slot.from}`),
  }));
}

/** 0（困得不行）到 1（很精神）：按作息和此刻的位置算，不持久化。 */
export function energyAt(life) {
  if (Number.isFinite(life?.energy)) return life.energy;
  if (life.asleep) return 0.15;
  if (life.minute < 480) return 0.3;
  if (life.minute < 600) return 0.75;
  if (life.minute < 780) return 0.9;
  if (life.minute < 840) return 0.6;
  if (life.minute < 1080) return 0.7;
  if (life.minute < 1260) return 0.55;
  if (life.minute < 1380) return 0.35;
  return 0.2;
}

/** 中文时间短语：「周五晚上九点二十」。 */
export function timePhrase(life) {
  const hour = Math.floor(life.minute / 60);
  const minute = life.minute % 60;
  const part = hour < 5 ? "凌晨" : hour < 8 ? "早上" : hour < 11 ? "上午" : hour < 13 ? "中午" : hour < 17 ? "下午" : hour < 19 ? "傍晚" : "晚上";
  return `${life.weekday}${part}${hourCn(hour)}点${minuteCn(minute)}`;
}

const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

function hourCn(hour) {
  const value = hour % 24;
  return CN[value <= 12 ? value : value - 12];
}

function minuteCn(minute) {
  if (minute === 0) return "";
  if (minute === 30) return "半";
  if (minute < 10) return `零${CN[minute]}`;
  if (minute < 20) return `十${minute % 10 ? CN[minute % 10] : ""}`;
  return `${CN[Math.floor(minute / 10)]}十${minute % 10 ? CN[minute % 10] : ""}`;
}

/**
 * 她此刻的一段话。给 prompt 用，不给数值。
 *
 * @param {ReturnType<typeof lifeAt>} life
 * @param {{compact?: boolean}} [options] compact = 只留「什么时候 + 在做什么」
 */
export function lifeBlock(life, { compact = false } = {}) {
  const when = timePhrase(life);
  if (compact) return `现在是${when}，你在${life.place}，${life.activity}。`;
  const tail = life.asleep ? "睡着的，没有在做任何事。" : `你在${life.place}，${life.activity}。`;
  return `现在是${when}。${tail}`;
}

/** 给「她今天过得怎么样」用的一句话，不比 lifeBlock 更细。 */
export function dayLine(life) {
  return `${life.weekday}：${life.asleep ? "睡着" : `${life.place}，${life.activity}`}`;
}

export const __test__ = { hash, pick, DEFAULT_WEEKDAY_SLOTS, DEFAULT_WEEKEND_SLOTS, DAY };
