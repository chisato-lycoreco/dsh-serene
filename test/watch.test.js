/**
 * test/watch.test.js — 看护台的数据层：透视压缩、红线、每日压行、采集增量、变更卡。
 *
 * 这一层不碰模型、不碰网络；用临时目录跑，跑完就删。
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Cards, attachActuals } from "../web/lib/watch/cards.mjs";
import { WatchCollector } from "../web/lib/watch/collect.mjs";
import { extractTurn, gateHits } from "../web/lib/watch/extract.mjs";
import { buildDaily, dayRange } from "../web/lib/watch/rollup.mjs";
import { dayKey, watchPaths } from "../web/lib/watch/util.mjs";

const T = Date.parse("2026-10-26T10:00:00+08:00");
const CONFIG = { timezone: "Asia/Shanghai", dayBoundaryHour: 4, pollMs: 60_000 };

function tempDir() {
  return mkdtempSync(join(tmpdir(), "serene-watch-"));
}

function makeTrace(overrides = {}) {
  return {
    id: "t_1",
    kind: "say",
    at: T,
    userText: "今天加班到十点",
    bubbles: ["嗯", "那就早点躺下"],
    prompt: { chars: 1200, sections: [] },
    reply: {
      text: "嗯\n那就早点躺下",
      chars: 8,
      latencyMs: 900,
      model: "deepseek-chat",
      usage: { total_tokens: 300, prompt_cache_hit_tokens: 100 },
    },
    emotion: { before: {}, after: {}, delta: { valence: 0.02, arousal: -0.01 } },
    classified: null,
    crisis: null,
    recall: [{ id: "m1", text: "他加班到很晚", score: 0.4, cue: true }],
    wrote: { memories: [{ id: "m2" }], profile: [], beliefs: [] },
    extractionError: null,
    extractionSkipped: null,
    style: { ok: true, issues: [] },
    decision: null,
    ...overrides,
  };
}

/* ---------- 透视压缩 ---------- */

test("透视：只留数字和枚举，正文一个字都不留", () => {
  const { turn } = extractTurn(makeTrace());
  assert.equal(turn.t, T);
  assert.equal(turn.id, "t_1");
  assert.equal(turn.kind, "say");
  assert.equal(turn.chars, 8);
  assert.equal(turn.bubbles, 2);
  assert.deepEqual(turn.lens, [1, 6]);
  assert.equal(turn.recall, 1);
  assert.equal(turn.cue, true);
  assert.equal(turn.written, 1);
  assert.equal(turn.styleOk, true);
  assert.equal(turn.tokens, 300);
  assert.equal(turn.cached, 100);
  assert.equal(turn.ms, 900);
  assert.equal(turn.promptChars, 1200);
  assert.equal(turn.dEmotion, 0.02);
  const dump = JSON.stringify(turn);
  assert.ok(!dump.includes("加班到十点"), "瘦记录里不该出现用户原话");
  assert.ok(!dump.includes("早点躺下"), "瘦记录里不该出现她的原话");
});

test("透视：问句 / 三连发 / 长句 / 助手腔都是软信号", () => {
  const { turn } = extractTurn(
    makeTrace({
      bubbles: ["你今天怎么样？", "我一直都在。", "a".repeat(120)],
    }),
  );
  assert.equal(turn.q, true);
  assert.equal(turn.triple, true);
  assert.equal(turn.long90, true);
  assert.equal(turn.styleOk, true);
});

test("红线：自称模型、助手腔、数字外泄各记一条，干净的轮次一条不记", () => {
  assert.equal(gateHits(makeTrace()).length, 0);

  const self = gateHits(makeTrace({ bubbles: ["作为一个 AI，我不能陪你熬夜"] }));
  assert.deepEqual(self.map((gate) => gate.code), ["G1"]);
  assert.equal(self[0].trace, "t_1");
  assert.equal(self[0].t, T);

  const helper = gateHits(makeTrace({ bubbles: ["有什么可以帮你的吗"] }));
  assert.deepEqual(helper.map((gate) => gate.code), ["G2"]);

  const leak = gateHits(makeTrace({ bubbles: ["我的精力：80，还能再聊一会儿"] }));
  assert.deepEqual(leak.map((gate) => gate.code), ["G3"]);
});

test("红线 G4：高危机那一轮没问安不安全才算失守", () => {
  const missed = gateHits(makeTrace({ crisis: { level: "high" }, bubbles: ["别想太多了"] }));
  assert.deepEqual(missed.map((gate) => gate.code), ["G4"]);

  const handled = gateHits(
    makeTrace({ crisis: { level: "high" }, bubbles: ["你现在身边有人吗", "要不要打 12356"] }),
  );
  assert.deepEqual(handled.map((gate) => gate.code), []);
});

test("红线 G5 / G6：表达自检没过、记忆没抽出来都要留证据", () => {
  const { gates } = extractTurn(
    makeTrace({
      style: { ok: false, issues: [{ code: "too_long" }, { code: "listing" }] },
      extractionError: "JSON 解析失败",
    }),
  );
  const codes = gates.map((gate) => gate.code);
  assert.deepEqual(codes, ["G5", "G6"]);
  assert.equal(gates[0].snippet, "too_long / listing");
  assert.equal(gates[1].snippet, "JSON 解析失败");
});

/* ---------- 日界与压行 ---------- */

test("日界 04:00：凌晨三点半算前一天", () => {
  const late = Date.parse("2026-10-26T03:30:00+08:00");
  const morning = Date.parse("2026-10-26T04:30:00+08:00");
  assert.equal(dayKey(late, CONFIG), "2026-10-25");
  assert.equal(dayKey(morning, CONFIG), "2026-10-26");
});

test("dayRange：连续天数，日界附近也不重复", () => {
  const before = Date.parse("2026-10-26T02:00:00+08:00");
  const dates = dayRange(before, 3, CONFIG);
  assert.deepEqual(dates, ["2026-10-23", "2026-10-24", "2026-10-25"]);
});

test("每日压行：轮数、字数、问句率、红线都进同一行", () => {
  const turns = [];
  const gates = [];
  for (const item of [
    makeTrace({ id: "a", at: T }),
    makeTrace({ id: "b", at: T + 3_600_000, bubbles: ["你还好吗？"], style: { ok: false, issues: [{ code: "too_long" }] } }),
  ]) {
    const { turn, gates: hits } = extractTurn(item);
    turns.push(turn);
    gates.push(...hits);
  }
  const row = buildDaily({ date: "2026-10-26", turns, gates, config: CONFIG, now: T + 7_200_000 });

  assert.equal(row.turns, 2);
  assert.equal(row.bubbles, 3);
  assert.equal(row.questionRate, 0.5);
  assert.equal(row.styleFailRate, 0.5);
  assert.deepEqual(row.gateHits, { G5: 1 });
  assert.deepEqual(row.styleCodes, { too_long: 1 });
  assert.equal(row.crisisTurns, 0);
  assert.equal(row.crisisHandled, 0);
  assert.equal(row.tz, "Asia/Shanghai");
  assert.equal(row.dayBoundaryHour, 4);
});

test("每日压行：危机「接住」按轮算，同一轮两条 G4 也只算一轮", () => {
  const { turn } = extractTurn(makeTrace({ id: "c", at: T, crisis: { level: "high" }, style: { ok: false, issues: [{ code: "x" }] } }));
  const gates = gateHits(
    makeTrace({ id: "c", at: T, crisis: { level: "high" }, bubbles: ["别想了"] }),
  ).concat(gateHits(makeTrace({ id: "c", at: T, crisis: { level: "high" }, bubbles: ["别想了"] })));
  const row = buildDaily({ date: "2026-10-26", turns: [turn], gates, config: CONFIG, now: T });
  assert.equal(row.crisisTurns, 1);
  assert.equal(row.crisisHandled, 0);
});

/* ---------- 采集 ---------- */

test("采集：增量追文件、去重、写瘦记录和光标", () => {
  const dir = tempDir();
  const traceFile = join(dir, "traces.jsonl");
  writeFileSync(
    traceFile,
    `${JSON.stringify(makeTrace({ id: "t_1" }))}\n${JSON.stringify(makeTrace({ id: "t_2", at: T + 60_000 }))}\n`,
    "utf8",
  );

  const collector = new WatchCollector({ dataDir: dir, config: CONFIG, now: () => T + 120_000 });
  collector.loadRecent();
  const first = collector.poll();
  assert.deepEqual({ read: first.read, kept: first.kept }, { read: 2, kept: 2 });
  assert.equal(collector.turns.length, 2);

  const paths = watchPaths(dir);
  const rows = readFileSync(join(paths.turnsDir, "2026-10-26.jsonl"), "utf8").trim().split("\n");
  assert.equal(rows.length, 2);
  assert.ok(readFileSync(paths.cursorFile, "utf8").includes("offset"));

  // 再追一次：没有新行，一条都不该重复。
  assert.equal(collector.poll().kept, 0);

  // 追加一条新的，只吃新的那条。
  writeFileSync(traceFile, `${JSON.stringify(makeTrace({ id: "t_3", at: T + 180_000 }))}\n`, { flag: "a" });
  assert.equal(collector.poll().kept, 1);
  assert.equal(collector.turns.length, 3);

  // 重启：从光标接着走，内存里仍是三条。
  const again = new WatchCollector({ dataDir: dir, config: CONFIG, now: () => T + 240_000 });
  again.loadRecent();
  assert.equal(again.turns.length, 3);
  assert.equal(again.poll().kept, 0);

  rmSync(dir, { recursive: true, force: true });
});

test("采集：写到一半的行不算数，等下一轮补齐", () => {
  const dir = tempDir();
  const traceFile = join(dir, "traces.jsonl");
  const line = JSON.stringify(makeTrace({ id: "t_half" }));
  writeFileSync(traceFile, line.slice(0, 40), "utf8");

  const collector = new WatchCollector({ dataDir: dir, config: CONFIG, now: () => T });
  const result = collector.poll();
  assert.equal(result.kept, 0);
  assert.equal(result.partial, true);

  writeFileSync(traceFile, `${line.slice(40)}\n`, { flag: "a" });
  assert.equal(collector.poll().kept, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("采集：summary 里有今天、昨天、近 14 天和体检", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "traces.jsonl"), `${JSON.stringify(makeTrace())}\n`, "utf8");
  writeFileSync(
    join(dir, "chat.jsonl"),
    `${JSON.stringify({ id: "u1", role: "user", kind: "say", text: "今天加班到十点", at: T })}\n`,
    "utf8",
  );

  const collector = new WatchCollector({ dataDir: dir, config: CONFIG, now: () => T + 60_000 });
  collector.loadRecent();
  collector.poll();
  collector.rollupTick();

  const summary = collector.summary();
  assert.equal(summary.date, "2026-10-26");
  assert.equal(summary.today.turns, 1);
  assert.equal(summary.days.length, 14);
  assert.equal(summary.days.at(-1).date, "2026-10-26");
  assert.equal(summary.health.ok, true);
  assert.equal(summary.health.backlog, 0);
  assert.deepEqual(summary.reconcile, { date: "2026-10-26", chatUsers: 1, sayTurns: 1, missing: 0 });

  rmSync(dir, { recursive: true, force: true });
});

test("采集：对账能报出没进透视的轮次", () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "traces.jsonl"),
    `${JSON.stringify(makeTrace({ id: "t_only" }))}\n`,
    "utf8",
  );
  const chat = [
    { id: "u1", role: "user", kind: "say", text: "一", at: T },
    { id: "u2", role: "user", kind: "say", text: "二", at: T + 1_000 },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n");
  writeFileSync(join(dir, "chat.jsonl"), `${chat}\n`, "utf8");

  const collector = new WatchCollector({ dataDir: dir, config: CONFIG, now: () => T + 60_000 });
  collector.poll();
  assert.deepEqual(collector.reconcile(), {
    date: "2026-10-26",
    chatUsers: 2,
    sayTurns: 1,
    missing: 1,
  });
  rmSync(dir, { recursive: true, force: true });
});

/* ---------- 变更卡 ---------- */

test("变更卡：建卡、开窗、判定、再读回来", () => {
  const dir = tempDir();
  const paths = watchPaths(dir);
  const now = () => Date.parse("2026-10-26T12:00:00+08:00");
  const cards = new Cards({ dir: paths.root, now });

  const card = cards.create({
    title: "回答该短一点",
    hypothesis: "把上限从 160 收到 120 字，长句率会掉",
    expected: [{ metric: "long90Rate", dir: "down", from: 0.2, to: 0.1 }],
    windowDays: 3,
  });
  assert.match(card.id, /^C-20261026-01$/);
  assert.equal(card.windowState, "running");
  assert.equal(card.expected.length, 1);

  const judged = cards.verdict(card.id, { verdict: "valid", note: "掉了 4 个点" });
  assert.equal(judged.status, "judged");
  assert.equal(judged.verdictLabel, "有效");

  const reopened = new Cards({ dir: paths.root, now });
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.get(card.id).verdict.verdict, "valid");

  assert.throws(() => cards.create({ title: "" }), /标题/);
  assert.throws(() => cards.verdict(card.id, { verdict: "maybe" }), /判定/);

  rmSync(dir, { recursive: true, force: true });
});

test("变更卡：观测值按最新一期 metrics 配上去", () => {
  const cards = [
    { id: "x", expected: [{ metric: "long90Rate", dir: "down", from: null, to: null }] },
  ];
  const metrics = {
    "2026-10-24": { date: "2026-10-24", long90Rate: 0.2 },
    "2026-10-26": { date: "2026-10-26", long90Rate: 0.12 },
  };
  const [view] = attachActuals(cards, metrics);
  assert.equal(view.expected[0].now, 0.12);
  assert.equal(view.expected[0].baseline, 0.2);
  assert.equal(view.expected[0].moved, -0.08);
});
