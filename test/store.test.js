import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmotionStore } from "../src/stores/emotion-store.js";
import { BASELINE } from "../core/emotion.js";

const T0 = Date.parse("2026-10-24T12:00:00+08:00");

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "serene-emotion-"));
  return { dir, store: new EmotionStore({ dir }), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("落盘：写一事件就有文件，重开读到同样的状态", (t) => {
  const { dir, store, cleanup } = tempStore();
  t.after(cleanup);

  store.record("affection", { now: T0 });
  assert.ok(existsSync(join(dir, "emotion.json")));
  const saved = JSON.parse(readFileSync(join(dir, "emotion.json"), "utf8"));
  assert.ok(saved.layers.primary.pleasure > BASELINE.primary.pleasure);

  const reopened = new EmotionStore({ dir }).snapshot({ now: T0 });
  assert.equal(reopened.layers.primary.pleasure, saved.layers.primary.pleasure);
});

test("时间：关掉再打开，状态会自己走一段", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);

  store.record("affection", { now: T0 });
  const before = store.snapshot({ now: T0 }).layers.primary.pleasure;
  const later = store.snapshot({ now: T0 + 6 * 3600_000 }).layers.primary.pleasure;
  assert.ok(later < before, "六小时后初级层的愉悦回落");
  assert.ok(later > BASELINE.primary.pleasure, "但没有直接归零");
});

test("疤：说死话会在基线上留下位移", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);

  store.load(T0);
  const result = store.record("conflict", { now: T0, context: "我们分手吧", intensity: 1.4 });
  assert.ok(result.wound, "这次要留疤");
  assert.ok(store.baseline.primary.pleasure < BASELINE.primary.pleasure);
  const snapshot = store.snapshot({ now: T0 });
  assert.equal(snapshot.wounds.length, 1);
});

test("敏感度：同一种负面事件连着来，第二次更疼", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);

  const first = store.record("scold", { now: T0 });
  const second = store.record("scold", { now: T0 + 60_000 });
  const drop = (r) => r.changed.find((item) => item.layer === "primary" && item.key === "pleasure")?.delta ?? 0;
  assert.ok(Math.abs(drop(second)) > Math.abs(drop(first)));
});

test("消息分类：过一遍 classifyMessage 再记事件", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);

  const hit = store.applyMessage({ text: "在吗" }, { now: T0 });
  assert.equal(hit.kind, "question");
  assert.equal(store.causes(T0).length, 1);
  assert.equal(store.applyMessage({ text: "在吗", from: "her" }, { now: T0 }), null);
});

test("重置：回到出厂基线，疤一起清掉", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);

  store.record("conflict", { now: T0, context: "分手吧" });
  store.reset({ now: T0 });
  const snapshot = store.snapshot({ now: T0 });
  assert.equal(snapshot.layers.primary.pleasure, BASELINE.primary.pleasure);
  assert.equal(snapshot.wounds.length, 0);
  assert.equal(store.baseline.primary.pleasure, BASELINE.primary.pleasure);
});

test("未知事件直接报错，不静默吞掉", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  assert.throws(() => store.record("nope", { now: T0 }), /未知事件/);
});

test("余震：高冲击的事会留一段尾巴，普通事件不留", (t) => {
  const { dir, store, cleanup } = tempStore();
  t.after(cleanup);

  const result = store.record("conflict", { now: T0, context: "我们分手吧", intensity: 1.4 });
  assert.ok(result.residue, "这一次要留余震");
  assert.ok(result.residue.halfLifeHours >= 24 && result.residue.halfLifeHours <= 48);
  assert.ok(result.residue.delta.pleasure < -8);

  const saved = JSON.parse(readFileSync(join(dir, "emotion.json"), "utf8"));
  assert.equal(saved.residue.length, 1);
  assert.equal(saved.residue[0].delta.pleasure, result.residue.delta.pleasure);
  assert.equal(new EmotionStore({ dir }).snapshot({ now: T0 }).residue.length, 1, "重开还在");

  const calm = tempStore();
  t.after(calm.cleanup);
  assert.equal(calm.store.record("chat", { now: T0 }).residue, null, "普通聊天不留");

  const week = store.snapshot({ now: T0 + 8 * 86_400_000 });
  assert.equal(week.residue.length, 0, "一周后清掉");
});

test("余震真的作用到底色：同样的状态，有尾巴的那份 48 小时后还更低", (t) => {
  const a = tempStore();
  t.after(a.cleanup);
  a.store.record("conflict", { now: T0, context: "我们分手吧", intensity: 1.4 });
  const raw = JSON.parse(readFileSync(join(a.dir, "emotion.json"), "utf8"));

  const b = tempStore();
  t.after(b.cleanup);
  writeFileSync(join(b.dir, "emotion.json"), JSON.stringify({ ...raw, residue: [] }), "utf8");

  const withTail = a.store.snapshot({ now: T0 + 48 * 3600_000 }).layers.background.pleasure;
  const withoutTail = new EmotionStore({ dir: b.dir }).snapshot({ now: T0 + 48 * 3600_000 }).layers.background.pleasure;
  assert.ok(withTail < withoutTail - 0.5, `有尾巴的那份应该更低（${withTail} vs ${withoutTail}）`);
});
