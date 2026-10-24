import test from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_KINDS,
  MAX_TEXT_CHARS,
  activationOf,
  activate,
  initialStability,
  normalizeMemory,
  reinforce,
  retention,
  tokenize,
} from "../core/recall.js";

const NOW = Date.parse("2026-10-24T12:00:00+08:00");
const DAY = 86_400_000;

const memory = (overrides = {}) =>
  normalizeMemory({ text: "在青岛的海边捡了块石头", createdAt: NOW, importance: 0.6, ...overrides }, { now: NOW });

test("记忆类型：六类都认得，写错回落 fact", () => {
  assert.deepEqual(MEMORY_KINDS, ["fact", "preference", "moment", "promise", "insight", "self"]);
  assert.equal(normalizeMemory({ text: "她怕打雷", kind: "promise" }).kind, "promise");
  assert.equal(normalizeMemory({ text: "她怕打雷", kind: "乱写" }).kind, "fact");
});

test("字数上限：新写入只留 80，读旧数据不替人改历史", () => {
  const long = normalizeMemory({ text: "字".repeat(MAX_TEXT_CHARS + 5) });
  assert.equal(Array.from(long.text).length, MAX_TEXT_CHARS);
  const legacy = normalizeMemory({ text: "字".repeat(200) }, { maxChars: Infinity });
  assert.equal(Array.from(legacy.text).length, 200);
});

test("稳定度：重要的事记得牢，时刻与承诺再乘 1.3", () => {
  assert.equal(initialStability({ importance: 0.5 }), 4.5);
  assert.equal(initialStability({ importance: 0.5, kind: "moment" }), 5.85);
  const old = memory({ createdAt: NOW - 300 * DAY });
  const fresh = memory();
  assert.ok(retention(old, NOW) < retention(fresh, NOW), "同一份稳定度，越久越淡");
  const important = memory({ createdAt: NOW - 300 * DAY, importance: 1, kind: "promise" });
  assert.ok(retention(important, NOW) > retention(old, NOW), "更重要的同年龄更清楚");
});

test("激活度：线索太弱直接出局，不参与抽样", () => {
  const chars = Array.from({ length: 60 }, (_, index) => String.fromCharCode(0x4e00 + index)).join("");
  const rare = memory({ text: chars });
  const query = tokenize(chars.slice(0, 2));
  assert.ok(activationOf(rare, query, NOW) > -Infinity, "有线索就有分");
  assert.equal(activationOf(rare, query, NOW, { minCue: 0.9 }), -Infinity, "低于 minCue 的出局");
});

test("允许 0 条：没有相关的就如实返回空", () => {
  const memories = [memory({ createdAt: NOW - 400 * DAY, importance: 0.1 })];
  assert.deepEqual(activate(memories, "量子力学 对撞机", { now: NOW }), []);
  assert.deepEqual(activate([], "青岛", { now: NOW }), []);
});

test("不补位：有几条给几条，不拿不相关的凑数", () => {
  const memories = [memory({ id: "a" }), memory({ id: "b" }), memory({ id: "c", text: "今天修好了路由器" })];
  const found = activate(memories, "青岛 海", { now: NOW, limit: 6 });
  assert.equal(found.length, 2);
  assert.ok(found.every((item) => item.text.includes("海") || item.text.includes("青岛")));
});

test("确定性：同样的查询、同样的时间，结果一模一样", () => {
  const memories = [memory({ id: "a" }), memory({ id: "b", importance: 0.9 }), memory({ id: "c" })];
  const once = activate(memories, "青岛", { now: NOW });
  const twice = activate(memories, "青岛", { now: NOW });
  assert.deepEqual(once, twice);
});

test("心情染色：只给非事实类，±0.45；事实不染", () => {
  const moment = memory({ kind: "moment", id: "m1" });
  const fact = memory({ kind: "fact", id: "f1" });
  const query = tokenize("青岛");
  const diff = (item) => activationOf(item, query, NOW, { mood: 1 }) - activationOf(item, query, NOW, { mood: -1 });
  assert.ok(Math.abs(diff(moment) - 0.9) < 1e-6, "暖 0.45、冷 −0.45，差 0.9");
  assert.equal(diff(fact), 0, "事实不随心情变");
});

test("强化：隔一阵再想起才明显，同一刻几乎不长，封顶 10 年", () => {
  const fresh = reinforce(memory(), { now: NOW });
  assert.ok(Math.abs(fresh.gain - 1) < 1e-3, "同一刻连想不长");

  const later = reinforce(memory(), { now: NOW + 5 * DAY });
  assert.ok(later.gain > 1.2, "隔几天再想起，稳固度明显上升");
  assert.equal(later.recallCount, 1);
  assert.equal(later.lastRecall, NOW + 5 * DAY);

  const stable = reinforce(memory({ stability: 3600, createdAt: NOW }), { now: NOW + 1000 * DAY });
  assert.ok(stable.stability <= 3650, "封顶生效");
});
