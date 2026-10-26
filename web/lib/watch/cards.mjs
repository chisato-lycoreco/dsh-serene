/**
 * web/lib/watch/cards.mjs — 变更卡：把「改前预期 → 观察窗 → 判定」变成能读的台账。
 *
 * 这是看护台和普通监控的区别：指标只说明「她现在什么样」，
 * 只有卡能说明「这次改动有没有用」。卡上写预期，窗口到了就逼人判一次；
 * 没判的卡会一直挂在那儿，比一条绿色曲线诚实。
 *
 * 存储：一次追加一行完整快照，读的时候后写覆盖先写（无删除，可回溯）。
 */

import { join } from "node:path";

import { appendJsonl, readJsonl, safeText } from "./util.mjs";

const VERDICTS = new Set(["valid", "invalid", "harmful", "untested"]);
const DAY = 86_400_000;

export const VERDICT_LABELS = Object.freeze({
  valid: "有效",
  invalid: "无效",
  harmful: "有害",
  untested: "未测",
});

function stamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("-", "");
}

export class Cards {
  constructor({ dir, now = () => Date.now() } = {}) {
    if (!dir) throw new Error("Cards 需要 dir");
    this.file = join(dir, "cards.jsonl");
    this.now = now;
    this.cards = new Map();
    for (const card of readJsonl(this.file)) {
      if (card?.id) this.cards.set(card.id, card);
    }
  }

  list() {
    return [...this.cards.values()]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .map((card) => this.view(card));
  }

  get(id) {
    const card = this.cards.get(String(id));
    return card ? this.view(card) : null;
  }

  create(input = {}) {
    const title = safeText(input.title, 80);
    if (!title) throw new Error("卡要有标题");
    const now = this.now();
    const seq = [...this.cards.keys()].filter((id) => id.includes(stamp())).length + 1;
    const id = input.id || `C-${stamp()}-${String(seq).padStart(2, "0")}`;
    const card = {
      id,
      title,
      hypothesis: safeText(input.hypothesis, 300),
      touches: Array.isArray(input.touches) ? input.touches.map((t) => safeText(t, 40)) : [],
      expected: Array.isArray(input.expected)
        ? input.expected
            .filter((item) => item && item.metric)
            .map((item) => ({
              metric: safeText(item.metric, 40),
              dir: ["up", "down"].includes(item.dir) ? item.dir : "down",
              from: Number.isFinite(Number(item.from)) ? Number(item.from) : null,
              to: Number.isFinite(Number(item.to)) ? Number(item.to) : null,
            }))
        : [],
      windowDays: Math.max(1, Math.min(90, Number(input.windowDays) || 3)),
      start: input.start ? String(input.start).slice(0, 10) : new Date(now).toISOString().slice(0, 10),
      abortIf: safeText(input.abortIf, 200),
      rollbackAt: safeText(input.rollbackAt, 80),
      status: "running",
      createdAt: now,
      verdict: null,
    };
    this.persist(card);
    return this.view(card);
  }

  verdict(id, { verdict, note = "", by = "user" } = {}) {
    if (!VERDICTS.has(verdict)) throw new Error("判定只能是 有效 / 无效 / 有害 / 未测");
    const current = this.cards.get(String(id));
    if (!current) throw new Error("没有这张卡");
    const card = {
      ...current,
      status: verdict === "untested" ? "untested" : "judged",
      verdict: {
        verdict,
        note: safeText(note, 400),
        by: safeText(by, 20),
        at: this.now(),
      },
    };
    this.persist(card);
    return this.view(card);
  }

  persist(card) {
    this.cards.set(card.id, card);
    appendJsonl(this.file, card);
  }

  view(card) {
    const startAt = Date.parse(`${card.start}T00:00:00+08:00`) || card.createdAt;
    const endAt = startAt + card.windowDays * DAY;
    const now = this.now();
    return {
      ...card,
      startAt,
      endAt,
      daysIn: Math.max(0, Math.floor((now - startAt) / DAY)),
      daysLeft: Math.ceil((endAt - now) / DAY),
      windowState:
        card.status === "judged" || card.status === "untested"
          ? card.status
          : now >= endAt
            ? "window_closed"
            : "running",
      verdictLabel: card.verdict ? VERDICT_LABELS[card.verdict.verdict] : "",
    };
  }
}

/** 用最近一期 metrics 给卡上的预期配一个「现在是多少」。 */
export function attachActuals(cards, metrics) {
  const dates = Object.keys(metrics ?? {}).sort();
  const latest = dates.length ? metrics[dates[dates.length - 1]] : null;
  const first = dates.length ? metrics[dates[0]] : null;
  return cards.map((card) => ({
    ...card,
    expected: card.expected.map((item) => {
      const nowValue = latest && Number.isFinite(latest[item.metric]) ? latest[item.metric] : null;
      const baseValue = first && Number.isFinite(first[item.metric]) ? first[item.metric] : item.from;
      return {
        ...item,
        now: nowValue,
        nowDate: latest?.date ?? null,
        baseline: baseValue,
        moved: nowValue != null && baseValue != null ? Math.round((nowValue - baseValue) * 1000) / 1000 : null,
      };
    }),
  }));
}
