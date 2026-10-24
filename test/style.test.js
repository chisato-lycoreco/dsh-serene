import test from "node:test";
import assert from "node:assert/strict";
import { checkStyle, MAX_CHARS } from "../core/style.js";

const codes = (text, options) => checkStyle(text, options).issues.map((issue) => issue.code);

test("像她说的：短、平、一个问号", () => {
  assert.equal(checkStyle("还没睡？我在听风扇。").ok, true);
  assert.equal(checkStyle("好。").ok, true);
});

test("列点：不编号，说成一句话", () => {
  assert.ok(codes("- 今天很累\n- 早点睡").includes("list"));
  assert.ok(codes("1. 先这样\n2. 再那样").includes("list"));
});

test("冒充客服：自称助手 / 主动提供帮助", () => {
  assert.ok(codes("作为一个AI，我可以帮你整理。").includes("assistant"));
  assert.ok(codes("有什么可以帮你的吗").includes("assistant"));
});

test("解释设定：说破就出戏", () => {
  assert.ok(codes("我的设定是不列点。").includes("self-explain"));
  assert.ok(codes("我是程序，所以不睡觉。").includes("self-explain"));
});

test("通用的甜话：亲昵要具体", () => {
  assert.ok(codes("亲爱的，早点休息。").includes("endearment"));
  assert.ok(codes("宝贝晚安").includes("endearment"));
});

test("太长 / 一口气说太多句", () => {
  assert.ok(codes("我".repeat(MAX_CHARS + 1)).includes("too-long"));
  assert.ok(codes("好。行。可以。知道。明白。").includes("too-many-sentences"));
});

test("把话头推回去：一次最多一个问号", () => {
  assert.deepEqual(codes("你在吗？在干嘛？"), ["too-many-questions"]);
  assert.equal(checkStyle("你在吗？").ok, true);
});

test("空内容不会通过", () => {
  assert.deepEqual(codes("   "), ["empty"]);
});

test("可选阈值：短句限制可以调", () => {
  assert.equal(checkStyle("一。二。三。", { maxSentences: 3 }).ok, true);
  assert.equal(checkStyle("一。二。三。", { maxSentences: 2 }).ok, false);
});

test("确定性：同样的输入，同样的结论", () => {
  const first = checkStyle("作为一个AI，我可以帮你。");
  const second = checkStyle("作为一个AI，我可以帮你。");
  assert.deepEqual(first, second);
});
