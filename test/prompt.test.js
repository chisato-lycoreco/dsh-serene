import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadPersona } from "../src/persona.js";
import { buildSereneSection, normalizeDepth, recentMemories } from "../src/prompt.js";

const root = fileURLToPath(new URL("../personas", import.meta.url));
const zhiyao = loadPersona("zhiyao", { root });
const now = Date.parse("2026-10-24T12:40:00Z"); // 北京 20:40

test("知遥常驻段：人格 + 此刻 + 外面 + 她本来就相信的", () => {
  const text = buildSereneSection({ persona: zhiyao, now });
  assert.match(text, /你叫知遥/);
  assert.match(text, /【此刻】现在是周六晚上八点四十/);
  assert.match(text, /【外面】/);
  assert.match(text, /日子：2026 年 10 月 24 日，周六，仲秋（十月下旬）/);
  assert.match(text, /你相信：/);
  assert.match(text, /被认真听完比被夸难得/);
});

test("外面有天气时多一行；语气是「背景」不是「播报」", () => {
  const text = buildSereneSection({
    persona: zhiyao,
    now,
    weather: { temperature: 20, label: "小雨", rain: true, isDay: false },
  });
  assert.match(text, /天气：外面在下小雨，20℃/);
  assert.match(text, /天已经黑了/);
  assert.match(text, /不用主动报天气/);
});

test("depth=short：只留人格、此刻、外面", () => {
  const text = buildSereneSection({
    persona: zhiyao,
    now,
    depth: "short",
    beliefs: [{ topic: "雨声让人安心", stance: 0.6, confidence: 0.5 }],
    profile: [{ dimension: "rhythm", value: "他睡得晚", count: 2, confidence: 0.5 }],
    memory: { all: () => [{ text: "他借了一本书", createdAt: 1 }] },
  });
  assert.match(text, /【此刻】/);
  assert.match(text, /【外面】/);
  assert.doesNotMatch(text, /你相信/);
  assert.doesNotMatch(text, /你注意到/);
  assert.doesNotMatch(text, /【你记着的】/);
});

test("depth=deep：夜里那段进 prompt，normal 不进", () => {
  const reflection = "【夜里】\n今天你记下的：他借了一本书。";
  const normal = buildSereneSection({ persona: zhiyao, now, reflection });
  const deep = buildSereneSection({ persona: zhiyao, now, reflection, depth: "deep" });
  assert.doesNotMatch(normal, /【夜里】/);
  assert.match(deep, /【夜里】/);
});

test("读到的、答应过的，和对方亲口说的分开标", () => {
  const memory = {
    all: () => [
      { text: "《海边的卡夫卡》——潮声是慢的", source: "learning", createdAt: 3 },
      { text: "十点前回来", kind: "promise", createdAt: 2 },
      { text: "他怕打雷", createdAt: 1 },
    ],
  };
  const lines = recentMemories(memory, 3);
  assert.deepEqual(lines, ["（读到的）《海边的卡夫卡》——潮声是慢的", "（答应过）十点前回来", "他怕打雷"]);
  const text = buildSereneSection({ persona: zhiyao, now, memory });
  assert.match(text, /【你记着的】（读到的）《海边的卡夫卡》/);
});

test("深度只认 short / normal / deep", () => {
  assert.equal(normalizeDepth("short"), "short");
  assert.equal(normalizeDepth("deep"), "deep");
  assert.equal(normalizeDepth("随便"), "normal");
  assert.equal(normalizeDepth(undefined), "normal");
});
