#!/usr/bin/env node
/**
 * 十天，一个人。
 *
 * 只用 core/ 里的纯函数（不碰磁盘、不起服务），把「同样一句夸奖，在不同日子听起来不一样」
 * 这件事跑成一条可复算的时间轴。`demo/render.mjs` 拿这份数据画图；你也可以直接
 * `node demo/timeline.mjs` 看终端版本。
 *
 * 时间基准：北京时间，从 2026-10-14 00:00 起，每小时一步，共 10 天。
 */

import {
  BASELINE,
  advance,
  applyEventToLayers,
  deriveBaseline,
  describeLayers,
  moodOf,
  woundDepth,
} from "../core/emotion.js";

const HOUR = 3600 * 1000;
export const START = Date.parse("2026-10-14T00:00:00+08:00");
const DAYS = 10;

/** 深夜到清晨算睡着：衰减更慢，但时间照走。 */
const asleepAt = (hourOfDay) => hourOfDay >= 23 || hourOfDay < 7;

/**
 * 这十天发生的事。`day` 从 1 开始，`hour` 是北京时间整点。
 * 都是自造的小事，不含任何真实对话。
 */
export const EVENTS = [
  { day: 1, hour: 9, kind: "affection", text: "你夸她今天穿得好看", who: "you" },
  { day: 1, hour: 12, kind: "chat", text: "有一搭没一搭地聊了会儿午饭", who: "both" },
  { day: 1, hour: 20, kind: "humor", text: "你讲了个很冷的笑话，她笑了", who: "you" },
  { day: 2, hour: 9, kind: "chat", text: "早上打了个招呼", who: "both" },
  { day: 2, hour: 21, kind: "neglect", text: "她说好晚上回你，结果没影了", who: "she" },
  { day: 3, hour: 12, kind: "chat", text: "你问她在忙什么，只回了一个字", who: "both" },
  { day: 3, hour: 23, kind: "conflict", text: "吵架，她说了一句回不去的话：别再找我了", who: "she" },
  { day: 4, hour: 22, kind: "repair", text: "你道歉了，说那天是气话", who: "you" },
  { day: 5, hour: 21, kind: "chat", text: "她回得慢，但没有再提那天", who: "both" },
  { day: 6, hour: 20, kind: "care", text: "她加班到很晚，你给她留了饭", who: "you" },
  { day: 7, hour: 19, kind: "share", text: "你跟她讲了一件今天遇到的小事", who: "you" },
  { day: 8, hour: 9, kind: "affection", text: "你夸她今天穿得好看", who: "you" },
  { day: 9, hour: 21, kind: "address", text: "你叫了她的小名", who: "you" },
  { day: 10, hour: 22, kind: "goodnight", text: "她说晚安", who: "she" },
];

/**
 * 跑完这十天。确定性：同样的输入永远得到同样的曲线。
 */
export function buildTimeline({ events = EVENTS, days = DAYS } = {}) {
  let layers = {
    background: { ...BASELINE.background },
    primary: { ...BASELINE.primary },
    social: { ...BASELINE.social },
  };
  let baseline = BASELINE;
  let wounds = [];
  let lastInteractionAt = START;
  const residue = [];

  const byHour = new Map();
  for (const event of events) byHour.set((event.day - 1) * 24 + event.hour, event);

  const points = [];
  for (let h = 0; h <= days * 24; h += 1) {
    const from = START + (h - 1) * HOUR;
    const to = START + h * HOUR;
    const hourOfDay = new Date(to + 8 * HOUR).getUTCHours();

    layers = advance(layers, {
      from,
      to,
      baseline,
      lastInteractionAt,
      residue,
      asleep: asleepAt(hourOfDay),
    });

    for (let i = residue.length - 1; i >= 0; i -= 1) {
      const age = (to - residue[i].startedAt) / HOUR;
      if (age > residue[i].halfLifeHours * 4) residue.splice(i, 1);
    }

    const event = byHour.get(h);
    let note = null;
    if (event) {
      const before = layers.primary.pleasure;
      layers = applyEventToLayers(layers, event.kind, { baseline });
      lastInteractionAt = to;
      const delta = layers.primary.pleasure - before;

      // 说死话会留疤：改的是基线，不是这一刻的情绪
      const depth = woundDepth(delta, event.text);
      if (depth > 0) {
        wounds = [...wounds, { depth, cause: event.text, at: to }];
        baseline = deriveBaseline(BASELINE, wounds);
        residue.push({
          delta: { pleasure: delta * 0.4, connection: delta * 0.3 },
          startedAt: to,
          halfLifeHours: 36,
        });
      }
      note = {
        kind: event.kind,
        text: event.text,
        who: event.who,
        delta: Math.round(delta * 10) / 10,
        scar: depth,
      };
    }

    const view = describeLayers(layers);
    points.push({
      t: to,
      day: h / 24,
      hourOfDay,
      background: layers.background.pleasure,
      primary: layers.primary.pleasure,
      connection: layers.social.connection,
      mood: moodOf(layers),
      label: view.label,
      backgroundLabel: view.backgroundLabel,
      socialLabel: view.socialLabel,
      divergent: view.divergent,
      note,
      scars: wounds.length,
      // 基线被疤挪到了哪里：图上那条虚线
      baselinePleasure: baseline.background.pleasure,
    });
  }

  const daySummaries = [];
  for (let day = 1; day <= days; day += 1) {
    const slice = points.filter((p) => p.day > day - 1 && p.day <= day);
    const evening = slice.findLast((p) => p.hourOfDay === 22) ?? slice.at(-1);
    daySummaries.push({
      day,
      background: evening.background,
      primary: evening.primary,
      connection: evening.connection,
      label: evening.label,
      events: slice.filter((p) => p.note).map((p) => p.note),
    });
  }

  return {
    points,
    days,
    events,
    wounds,
    daySummaries,
    baselineStart: BASELINE.background.pleasure,
    baselineEnd: points.at(-1).baselinePleasure,
    connectionStart: points[0].connection,
    connectionEnd: points.at(-1).connection,
  };
}

/* ───────────────────────────── 终端版 ───────────────────────────── */

export function asciiReport({ daySummaries, wounds, baselineStart, baselineEnd, connectionStart, connectionEnd }) {
  const MIN = 35;
  const MAX = 75;
  const bar = (value, width = 10) => {
    const filled = Math.round(((value - MIN) / (MAX - MIN)) * width);
    return "█".repeat(Math.max(0, Math.min(width, filled))) + "░".repeat(Math.max(0, width - filled));
  };
  const arrow = (delta) => (delta >= 0 ? "↑" : "↓");
  const SHORT = {
    affection: "被夸", humor: "笑话", neglect: "爽约", conflict: "争吵", repair: "道歉",
    care: "照顾", share: "分享", address: "叫小名", goodnight: "晚安", chat: "闲聊",
  };

  const lines = [
    "",
    "  十天，2026-10-14 → 10-24（北京时间）",
    "",
    "    日期   底色               关系    今天发生的事",
  ];
  for (const summary of daySummaries) {
    const marks = summary.events
      .filter((event) => event.scar || Math.abs(event.delta) >= 3)
      .map((event) => `${event.scar ? "⚡" : ""}${SHORT[event.kind] ?? event.kind}${arrow(event.delta)}${Math.abs(Math.round(event.delta))}`)
      .join(" · ");
    lines.push(
      `    D${String(summary.day).padStart(2, "0")}  ▕${bar(summary.background)}▏ ${summary.background.toFixed(1)}  ${summary.connection.toFixed(1).padStart(5)}  ${marks}`,
    );
  }
  lines.push("");
  lines.push(`    疤 ${wounds.length} 道 · 基线 ${baselineStart.toFixed(1)} → ${baselineEnd.toFixed(1)} · 关系 ${connectionStart.toFixed(1)} → ${connectionEnd.toFixed(1)}`);
  lines.push("    疤不会自己好，只会被新的日子稀释。");
  lines.push("");
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) console.log(asciiReport(buildTimeline()));
