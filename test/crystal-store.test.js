import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrystalStore } from "../src/stores/crystal-store.js";

const NOW = Date.parse("2026-10-26T12:00:00+08:00");

function tempStore(t, seeds = null) {
  const dir = mkdtempSync(join(tmpdir(), "serene-crystal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new CrystalStore({ dir, seeds }) };
}

function fileLesson(overrides = {}) {
  return {
    id: "ls_file",
    situation: "他连着两次说马上，人还在忙",
    did: "没催，只问要不要把事挪到明天",
    outcome: "第二次他自己收了",
    next: "先等十分钟，再问要不要挪",
    counter: "他明确说今天必须做完时别等",
    when: ["马上", "在忙"],
    evidence: ["m_1", "m_2"],
    confidence: 0.6,
    ...overrides,
  };
}

function fileDisposition(overrides = {}) {
  return {
    id: "dp_file",
    text: "先看他做了什么，再听他说了什么",
    because: "说想早睡，到点真走了；嘴上说没事，第二天还是没来；答应在忙先说一声，后来真说了",
    limit: "他明确开口要什么时，先信那句话",
    evidence: ["m_1", "m_2", "m_3"],
    since: NOW,
    ...overrides,
  };
}

const SEEDS = {
  lessons: [
    {
      id: "ls_seed",
      situation: "他半夜说饿",
      did: "没讲道理，去煮了面",
      outcome: "他吃完了",
      next: "先煮面",
      counter: "他刚吃过就别煮",
      when: ["饿"],
      evidence: ["m_seed_1", "m_seed_2"],
      confidence: 0.5,
    },
  ],
  dispositions: [
    {
      id: "dp_seed",
      text: "先做再说，不先保证",
      because: "答应的事都做了；做不到的会先讲清",
      limit: "他只要一句准话时，先把话说明白",
      evidence: ["m_seed_1", "m_seed_2", "m_seed_3"],
      since: NOW - 1000,
    },
  ],
};

test("没有文件时只读人格种子；坏文件不抛，记一条错误", (t) => {
  const { dir, store } = tempStore(t, SEEDS);
  assert.equal(store.lessons.length, 1);
  assert.equal(store.lessons[0].id, "ls_seed");
  assert.equal(store.dispositions.length, 1);
  assert.equal(store.dispositions[0].id, "dp_seed");
  assert.deepEqual(store.stats().errors, []);

  writeFileSync(join(dir, "lessons.jsonl"), "{不是 JSON}\n", "utf8");
  writeFileSync(join(dir, "dispositions.json"), "{也坏了", "utf8");
  const broken = new CrystalStore({ dir, seeds: SEEDS });
  assert.equal(broken.lessons.length, 1, "坏文件不该把种子也吞掉");
  assert.equal(broken.dispositions.length, 1);
  assert.equal(broken.stats().errors.length, 2);
});

test("文件条目按 id 盖过种子；两条不同 id 都留着", (t) => {
  const { dir, store } = tempStore(t, SEEDS);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "lessons.jsonl"),
    `${JSON.stringify(fileLesson())}\n${JSON.stringify(fileLesson({ id: "ls_seed", outcome: "改了" }))}\n`,
    "utf8",
  );
  writeFileSync(join(dir, "dispositions.json"), JSON.stringify({ version: 1, items: [fileDisposition()] }), "utf8");

  const reopened = new CrystalStore({ dir, seeds: SEEDS });
  assert.equal(reopened.lessons.length, 2);
  assert.equal(reopened.lessons.find((item) => item.id === "ls_seed").outcome, "改了");
  assert.equal(reopened.dispositions.length, 2);
  assert.equal(reopened.stats().files.lessons, true);
});

test("坏行只丢那一行，别的照读", (t) => {
  const { dir, store } = tempStore(t, SEEDS);
  writeFileSync(
    join(dir, "lessons.jsonl"),
    `${JSON.stringify(fileLesson({ id: "ls_ok" }))}\n这不是 json\n${JSON.stringify(fileLesson({ id: "ls_ok2" }))}\n`,
    "utf8",
  );
  const data = store.reload();
  assert.deepEqual(
    data.lessons.map((item) => item.id).sort(),
    ["ls_ok", "ls_ok2", "ls_seed"],
  );
  assert.equal(store.stats().errors.length, 1);
  assert.match(store.stats().errors[0], /第 2 行/);
});

test("文件后建也能读到：下一次访问按 mtime 自己刷新", async (t) => {
  const { dir, store } = tempStore(t, SEEDS);
  assert.equal(store.lessons.length, 1);
  writeFileSync(join(dir, "lessons.jsonl"), `${JSON.stringify(fileLesson())}\n`, "utf8");
  // 文件系统 mtime 粒度可能很粗；只要 stamp 变了就行。
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(store.lessons.length, 2);
  assert.ok(store.lessons.some((item) => item.id === "ls_file"));
});

test("只看 active 且过闸门的：stats 数得对", (t) => {
  const { dir, store } = tempStore(t);
  writeFileSync(
    join(dir, "lessons.jsonl"),
    [
      JSON.stringify(fileLesson({ id: "ls_ready" })),
      JSON.stringify(fileLesson({ id: "ls_no_counter", counter: "" })),
      JSON.stringify(fileLesson({ id: "ls_retired", status: "retired" })),
    ].join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "dispositions.json"),
    JSON.stringify([
      fileDisposition({ id: "dp_ready" }),
      fileDisposition({ id: "dp_short", evidence: ["m_1"] }),
    ]),
    "utf8",
  );
  const stats = store.stats();
  assert.equal(stats.lessons, 3);
  assert.equal(stats.lessonsReady, 1);
  assert.equal(stats.dispositions, 2);
  assert.equal(stats.dispositionsReady, 1);
});

test("两种 dispositions 形状都认：数组和 {items}", (t) => {
  const { dir } = tempStore(t);
  writeFileSync(join(dir, "dispositions.json"), JSON.stringify([fileDisposition({ id: "dp_array" })]), "utf8");
  assert.equal(new CrystalStore({ dir }).dispositions[0].id, "dp_array");
  writeFileSync(join(dir, "dispositions.json"), JSON.stringify({ items: [fileDisposition({ id: "dp_object" })] }), "utf8");
  assert.equal(new CrystalStore({ dir }).dispositions[0].id, "dp_object");
});
