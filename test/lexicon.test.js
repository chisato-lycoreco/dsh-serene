import test from "node:test";
import assert from "node:assert/strict";
import { classifyMessage } from "../core/emotion.js";
import { DEFAULT_PATTERNS, resolveLexicon } from "../core/lexicon.js";

test("默认词表不猜关系：没有「老婆 / 宝贝 / 吃醋」这些词", () => {
  const source = JSON.stringify(DEFAULT_PATTERNS);
  for (const word of ["老婆", "宝贝", "亲亲", "吃醋", "女的"]) {
    assert.ok(!source.includes(word), `默认词表里不该有「${word}」`);
  }
});

test("默认：提到别人不会自动吃醋", () => {
  const result = classifyMessage({ text: "我前女友今天来找我了" });
  assert.notEqual(result?.kind, "jealousy");
});

test("人格词表：写了 jealousy，才会吃醋", () => {
  const lexicon = { jealousy: ["前女友"] };
  assert.equal(classifyMessage({ text: "我前女友今天来找我了" }, { lexicon }).kind, "jealousy");
});

test("人格词表：否定句不算吃醋", () => {
  const lexicon = { jealousy: ["前女友"] };
  assert.equal(
    classifyMessage({ text: "前女友？没有别人，只有你" }, { lexicon }).kind !== "jealousy",
    true,
  );
});

test("人格词表：爱称要显式给，不给就不认", () => {
  const text = "宝贝，我回来了";
  assert.notEqual(classifyMessage({ text })?.kind, "affection");
  assert.equal(classifyMessage({ text }, { lexicon: { affection: ["宝贝"] } }).kind, "affection");
});

test("人格词表：同名词表是追加，不是替换", () => {
  const lexicon = { coax: ["乖乖"] };
  // 默认的「别生气了」还在
  assert.equal(classifyMessage({ text: "别生气了" }, { lexicon }).kind, "coax");
  // 人格自己加的也在
  assert.equal(classifyMessage({ text: "乖乖" }, { lexicon }).kind, "coax");
});

test("称呼：字面匹配，不做子串联想", () => {
  const lexicon = { address: ["小满"] };
  assert.equal(classifyMessage({ text: "小满，早" }, { lexicon }).kind, "address");
  assert.notEqual(classifyMessage({ text: "小满不满" }, { lexicon }).kind, "address");
});

test("未知动作回落 chat，不替人格猜「这是亲近」", () => {
  const result = classifyMessage({ action: { kind: "不存在的动作" } });
  assert.equal(result.kind, "chat");
});

test("词表写错要在编译时就报错", () => {
  assert.throws(() => resolveLexicon({ affection: ["["] }), /lexicon\.affection/);
});
