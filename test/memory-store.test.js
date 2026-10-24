import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/stores/memory-store.js";

const NOW = Date.parse("2026-10-24T12:00:00+08:00");
const DAY = 86_400_000;

function tempStore(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "serene-memory-"));
  const store = new MemoryStore({ dir, ...options });
  return { dir, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("落盘：一行一条，重开读得到同样的记忆", (t) => {
  const { dir, store, cleanup } = tempStore();
  t.after(cleanup);
  store.add({ text: "她怕打雷", kind: "preference", importance: 0.9 }, { now: NOW });
  assert.equal(store.size, 1);

  const raw = readFileSync(join(dir, "memories.jsonl"), "utf8").trim().split("\n");
  assert.equal(raw.length, 1);
  assert.equal(JSON.parse(raw[0]).kind, "preference");

  const reopened = new MemoryStore({ dir });
  const [saved] = reopened.all();
  assert.equal(saved.text, "她怕打雷");
  assert.equal(saved.importance, 0.9);
  assert.ok(saved.stability > 0);
});

test("强化：只追加 reinforce，不改原记忆行，读回时会折起来", (t) => {
  const { dir, store, cleanup } = tempStore();
  t.after(cleanup);
  const saved = store.add({ text: "她怕打雷", importance: 0.6 }, { now: NOW });
  const before = saved.stability;
  assert.equal(store.reinforce([saved.id], { now: NOW + 5 * DAY }).length, 1);

  const lines = readFileSync(join(dir, "memories.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "她怕打雷", "原行一个字段都没动");
  assert.equal(lines[1].type, "reinforce");

  const [reloaded] = new MemoryStore({ dir }).all();
  assert.equal(reloaded.recallCount, 1);
  assert.equal(reloaded.lastRecall, NOW + 5 * DAY);
  assert.ok(reloaded.stability > before);
});

test("容量：满了淘汰最不该留的那条，并且留下记录", (t) => {
  const { store, cleanup } = tempStore({ capacity: 10 });
  t.after(cleanup);
  for (let i = 0; i < 10; i += 1) {
    store.add({ text: `第${i}条记忆`, importance: i === 0 ? 0.05 : 0.5 + i / 100 }, { now: NOW });
  }
  const last = store.add({ text: "最新的这条", importance: 0.9 }, { now: NOW });
  assert.equal(store.size, 10);
  assert.ok(store.all().some((item) => item.id === last.id), "新写的一定在");

  const [forgotten] = store.forgotten();
  assert.equal(forgotten.reason, "capacity");
  assert.equal(forgotten.text, "第0条记忆", "淘汰的是最不重要的一条");
});

test("过期优先：过期的记忆先被淘汰，哪怕它更重要", (t) => {
  const { store, cleanup } = tempStore({ capacity: 10 });
  t.after(cleanup);
  store.add({ text: "过期的约定", importance: 0.95, validUntil: NOW - DAY }, { now: NOW });
  for (let i = 0; i < 9; i += 1) store.add({ text: `普通记忆${i}`, importance: 0.2 }, { now: NOW });
  store.add({ text: "新的一条", importance: 0.5 }, { now: NOW });

  const [forgotten] = store.forgotten();
  assert.equal(forgotten.text, "过期的约定");
  assert.equal(forgotten.reason, "expired");
});

test("召回：v2 允许 0 条，v1 可以回退", (t) => {
  const { dir, cleanup } = tempStore();
  t.after(cleanup);
  const store = new MemoryStore({ dir });
  store.add({ text: "今天修好了路由器", createdAt: NOW - 400 * DAY, importance: 0.1 }, { now: NOW - 400 * DAY });
  assert.deepEqual(store.recall("量子力学 对撞机", { now: NOW }), []);
  assert.equal(new MemoryStore({ dir, curve: "v1" }).curve, "v1");
});
