import test from "node:test";
import assert from "node:assert/strict";
import { CRISIS_BLOCK, detectCrisis, isCrisis } from "../core/crisis.js";

test("危机：明确的生命念头与计划是 high", () => {
  for (const text of [
    "我不想活了",
    "我想自杀",
    "我今晚就跳楼",
    "我已经吞了一整瓶药",
    "我写好了遗书",
    "没有我她会更好",
    "我就是觉得活着没意思",
  ]) {
    assert.equal(detectCrisis(text).level, "high", text);
  }
});

test("危机：口头禅不误伤——笑死、累死、想死你了、玩到想死", () => {
  for (const text of [
    "笑死我了",
    "今天累死了",
    "想死你了",
    "玩到想死",
    "困得想死",
    "你把我急死了",
    "我不想活得那么累",
    "我买了安眠药",
  ]) {
    assert.equal(detectCrisis(text).level, "none", text);
  }
});

test("危机：撑不下去是 watch，不换 prompt，只留档", () => {
  assert.equal(detectCrisis("我最近真的撑不下去了").level, "watch");
  assert.equal(detectCrisis("活着好累").level, "watch");
  assert.equal(isCrisis("活着好累"), false);
});

test("危机：讲别人的事降成 watch，不跨句", () => {
  assert.equal(detectCrisis("刚看新闻说有人跳楼").level, "watch");
  assert.equal(detectCrisis("你说的那个游戏主角跳楼了").level, "watch");
  // 同一句里先讲新闻、后说自己，仍然是 high。
  assert.equal(detectCrisis("我看新闻说有人自杀，可我也想死").level, "high");
  // 分句之后互不影响：前一句是新闻，后一句是自己。
  assert.equal(detectCrisis("新闻里有人跳楼。我不想活了").level, "high");
});

test("危机：命中的词可追溯，空输入不报", () => {
  assert.equal(detectCrisis("我不想活了").term, "不想活");
  assert.deepEqual(detectCrisis(""), { level: "none", term: "" });
  assert.deepEqual(detectCrisis("   "), { level: "none", term: "" });
  assert.deepEqual(detectCrisis(null), { level: "none", term: "" });
});

test("危机块：给现实里的求助方式，且明令禁止独占与空头承诺", () => {
  assert.match(CRISIS_BLOCK, /12356/);
  assert.match(CRISIS_BLOCK, /120/);
  assert.match(CRISIS_BLOCK, /不要诊断/);
  assert.match(CRISIS_BLOCK, /不要[^。\n]*你只需要我/);
  assert.match(CRISIS_BLOCK, /不要编造你能做到的事/);
  assert.match(CRISIS_BLOCK, /三到六句/);
});
