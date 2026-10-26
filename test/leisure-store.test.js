import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LeisureStore } from "../src/stores/leisure-store.js";

const NOW = Date.parse("2026-10-26T21:00:00+08:00");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function tempStore(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "serene-leisure-"));
  const store = new LeisureStore({ dir, ...options });
  return { dir, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("落盘：一行一条，重开读得到同一段消遣", (t) => {
  const { dir, store, cleanup } = tempStore();
  t.after(cleanup);

  const saved = store.record({
    kind: "movie",
    title: "海上钢琴师",
    minutes: 165,
    startAt: NOW,
    endAt: NOW + 165 * MINUTE,
    finished: true,
  });
  assert.ok(saved.id);
  assert.equal(saved.at, NOW, "at 是开始那一刻");
  assert.equal(saved.kind, "movie");
  assert.equal(saved.title, "海上钢琴师");
  assert.equal(saved.minutes, 165);
  assert.equal(saved.endAt, NOW + 165 * MINUTE);
  assert.equal(saved.finished, true);
  assert.equal(saved.unfinished, false);

  const lines = readFileSync(join(dir, "leisure.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).id, saved.id);

  const reopened = new LeisureStore({ dir });
  assert.deepEqual(reopened.all(), [saved]);
  assert.equal(reopened.size, 1);
});

test("record 兜底：只给 endAt 也能算出开始时间", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  const entry = store.record({ kind: "book", minutes: 30, endAt: NOW });
  assert.equal(entry.endAt, NOW);
  assert.equal(entry.startAt, NOW - 30 * MINUTE);
  assert.equal(entry.at, NOW - 30 * MINUTE);
});

test("activeAt：开始了、还没到点的那件", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  store.record({ kind: "music", minutes: 20, startAt: NOW - 60 * MINUTE, endAt: NOW - 40 * MINUTE });
  const ongoing = store.record({ kind: "game", minutes: 40, startAt: NOW - 10 * MINUTE, endAt: NOW + 30 * MINUTE });

  assert.equal(store.activeAt(NOW).id, ongoing.id);
  assert.equal(store.activeAt(NOW - 20 * MINUTE), null, "还没开始的不算手上");
  assert.equal(store.activeAt(NOW + 40 * MINUTE), null, "到点了就不算");
});

test("since / recent：按开始时间说话", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  const older = store.record({ kind: "video", minutes: 15, startAt: NOW - 3 * HOUR, endAt: NOW - 3 * HOUR + 15 * MINUTE });
  const middle = store.record({ kind: "book", minutes: 30, startAt: NOW - 2 * HOUR, endAt: NOW - 2 * HOUR + 30 * MINUTE });
  const latest = store.record({ kind: "music", minutes: 20, startAt: NOW - 1 * HOUR, endAt: NOW - 1 * HOUR + 20 * MINUTE });

  assert.deepEqual(store.since(NOW - 2 * HOUR).map((entry) => entry.id), [middle.id, latest.id]);
  assert.deepEqual(store.since(NOW).map((entry) => entry.id), []);

  const recent = store.recent(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].id, middle.id);
  assert.equal(recent[1].id, latest.id);
  assert.ok(recent[0].at < recent[1].at, "按时间正序");
  assert.equal(store.recent(99).length, 3);
  assert.ok(store.since(NOW - 10 * HOUR).some((entry) => entry.id === older.id));
});

test("坏行跳过：半截 JSON、缺字段都不抛", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "serene-leisure-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const good = {
    id: "ok",
    at: NOW,
    kind: "video",
    title: "一段视频",
    minutes: 20,
    startAt: NOW,
    endAt: NOW + 20 * MINUTE,
    finished: true,
    unfinished: false,
  };
  writeFileSync(
    join(dir, "leisure.jsonl"),
    [
      JSON.stringify(good),
      "这不是 JSON",
      JSON.stringify({ id: "no-kind", at: NOW, title: "没有类", minutes: 10, startAt: NOW, endAt: NOW + 10 * MINUTE }),
      JSON.stringify({ at: NOW, kind: "video", title: "没有 id", endAt: NOW + 10 * MINUTE }),
      JSON.stringify({ id: "no-time", kind: "video", title: "没有时间" }),
    ].join("\n") + "\n",
    "utf8",
  );

  const store = new LeisureStore({ dir });
  assert.equal(store.all().length, 1, "只留下那条好的");
  assert.equal(store.all()[0].id, "ok");
  assert.equal(store.activeAt(NOW + MINUTE).id, "ok");

  // 目录里什么都没有时，读出来是空数组，不抛
  const empty = new LeisureStore({ dir: join(dir, "现在还没有") });
  assert.deepEqual(empty.all(), []);
});

test("容量：超过 300 条只留最近 300 条，文件也一起收", (t) => {
  const { dir, store, cleanup } = tempStore();
  t.after(cleanup);
  for (let index = 0; index < 305; index += 1) {
    store.record({
      kind: "video",
      title: `第 ${index} 条`,
      minutes: 10,
      startAt: NOW + index * MINUTE,
      endAt: NOW + (index + 10) * MINUTE,
      finished: true,
    });
  }

  assert.equal(store.size, 300);
  const all = store.all();
  assert.equal(all.length, 300);
  assert.equal(all[0].title, "第 5 条", "最老的 5 条被挤掉了");
  assert.equal(all.at(-1).title, "第 304 条", "新写的一定在");

  const lines = readFileSync(join(dir, "leisure.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 300, "文件重写过，不是 305 行");

  assert.equal(new LeisureStore({ dir }).all().length, 300);
  assert.equal(new LeisureStore({ dir, capacity: 5 }).all().length, 5, "容量可调");
});
