import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMemory, rank, recency, score, tokenize } from "../core/recall.js";

const NOW = Date.parse("2026-10-24T12:00:00+08:00");
const DAY = 86_400_000;

test("分词：中文二元组 + 英文单词", () => {
  const tokens = tokenize("去了水族馆 Aquarium");
  assert.ok(tokens.includes("水族"));
  assert.ok(tokens.includes("族馆"));
  assert.ok(tokens.includes("aquarium"));
});

test("时间衰减：半衰期到了正好剩一半", () => {
  assert.ok(Math.abs(recency(NOW - 45 * DAY, NOW, 45) - 0.5) < 1e-9);
  assert.ok(recency(NOW - 90 * DAY, NOW, 45) < recency(NOW - 10 * DAY, NOW, 45));
});

test("打分：相关 + 更新 + 更重要 的排前面", () => {
  const memories = [
    { id: "old", text: "去年在青岛看过海", updatedAt: NOW - 300 * DAY, importance: 0.4 },
    { id: "new", text: "在青岛的海边捡了块石头", updatedAt: NOW - 2 * DAY, importance: 0.8 },
    { id: "other", text: "今天修好了路由器", updatedAt: NOW - 1 * DAY, importance: 0.9 },
  ];
  const found = rank(memories, "青岛 海", { now: NOW, limit: 3 });
  assert.equal(found[0].id, "new");
  assert.equal(found.length, 2, "不相关的不会被凑数召回");
  assert.ok(found[0].score > found[1].score);
});

test("打分：完全无关返回 0，空查询不召回", () => {
  const memory = { text: "在青岛的海边捡了块石头", updatedAt: NOW };
  assert.equal(score(memory, tokenize("量子力学"), NOW), 0);
  assert.deepEqual(rank([memory], "   ", { now: NOW }), []);
});

test("写入归一化：空文本拒绝，字段收敛到可落盘形状", () => {
  assert.equal(normalizeMemory({ text: "  " }), null);
  const memory = normalizeMemory({ text: "她怕打雷", importance: 3, tags: ["怕", 1, 2, 3, 4, 5, 6, 7, 8, 9] }, { now: NOW });
  assert.equal(memory.text, "她怕打雷");
  assert.equal(memory.importance, 1);
  assert.equal(memory.tags.length, 8);
  assert.equal(memory.createdAt, NOW);
  assert.ok(memory.id.startsWith("m_"));
});
