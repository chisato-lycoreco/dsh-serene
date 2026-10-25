import test from "node:test";
import assert from "node:assert/strict";
import { activate, anchorTokens, corpusDf, hitsAnchor, tokenize } from "../core/recall.js";

const NOW = Date.parse("2026-10-25T18:00:00+08:00");
const DAY = 86_400_000;

const memories = [
  {
    id: "m_comfy",
    text: "ComfyUI 的显存又爆了，上次改了半天 batch size 也没用",
    kind: "fact",
    importance: 0.5,
    createdAt: NOW - 2 * DAY,
  },
  {
    id: "m_router",
    text: "今天把路由器的固件升了，网速快了一点",
    kind: "fact",
    importance: 0.5,
    createdAt: NOW - 1 * DAY,
  },
];

test("专名锚点：拉丁词从查询里被认出来；常见词不算", () => {
  const df = corpusDf(memories);
  const anchors = anchorTokens(tokenize("comfyui 又爆了"), { df, mode: "latin" });
  assert.ok(anchors.has("comfyui"));
  assert.equal(anchors.has("又爆"), false, "中文二元组默认不当锚点");

  const common = new Map([["comfyui", 99]]);
  assert.equal(anchorTokens(["comfyui"], { df: common, mode: "latin" }).size, 0);
});

test("专名锚点：rare 模式才收低频中文词", () => {
  const rare = [
    { id: "a", text: "在青岛看过一次荧光海" },
    { id: "b", text: "今天把路由器的固件升了" },
  ];
  const df = corpusDf(rare);
  assert.equal(anchorTokens(["荧光"], { df, mode: "latin" }).size, 0);
  assert.ok(anchorTokens(["荧光"], { df, mode: "rare" }).has("荧光"));
  assert.equal(anchorTokens(["荧光"], { df, mode: "off" }).size, 0);
});

test("专名锚点：原话里的名字也算", () => {
  const memory = { id: "m1", text: "上次那个报错", evidence: ["ComfyUI 一启动就崩"] };
  const query = tokenize("comfyui");
  const anchors = anchorTokens(query, { df: corpusDf([memory]), mode: "latin" });
  assert.ok(hitsAnchor(memory, anchors));
});

test("召回：专名绕过 minCue，但没有这个专名的记忆不会被凑数", () => {
  const query = "comfyui 上次";
  const found = activate(memories, query, { now: NOW, minCue: 0.9, anchorMode: "latin" });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "m_comfy");
  assert.equal(found[0].anchored, true);
  assert.ok(found[0].cue < 0.9);
});

test("召回：关掉锚点就回到纯 minCue，一条都不给", () => {
  assert.deepEqual(activate(memories, "comfyui 上次", { now: NOW, minCue: 0.9, anchorMode: "off" }), []);
});

test("召回：原话里有、概括里没有，也能被那个名字捞回来", () => {
  const rows = [
    { id: "m1", text: "上次那个报错", evidence: ["ComfyUI 一启动就崩"], createdAt: NOW - DAY, importance: 0.6 },
    { id: "m2", text: "今天阳光很好", createdAt: NOW - DAY, importance: 0.6 },
  ];
  const found = activate(rows, "comfyui 还崩吗", { now: NOW, anchorMode: "latin" });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "m1");
  assert.equal(found[0].anchored, true);
});

test("召回：同样的输入永远同样的结果", () => {
  const a = activate(memories, "comfyui 显存", { now: NOW, anchorMode: "latin" });
  const b = activate(memories, "comfyui 显存", { now: NOW, anchorMode: "latin" });
  assert.deepEqual(a, b);
});
