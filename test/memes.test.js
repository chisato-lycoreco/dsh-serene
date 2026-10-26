import test from "node:test";
import assert from "node:assert/strict";
import { MEMES, MEME_LIMIT, matchMemes, memeBlock } from "../core/memes.js";

/** 卡上允许出现的分类。新加分类要在这里补一笔，别让它悄悄混进来。 */
const KINDS = new Set([
  "缩写",
  "谐音",
  "情绪",
  "阴阳",
  "感叹",
  "人物",
  "动作梗",
  "卖萌",
  "弹幕",
  "自嘲",
  "行为",
  "生活",
  "评价",
  "玩梗",
  "抗议",
]);

const ids = (text, options) => matchMemes(text, options).map((meme) => meme.id);

test("数据完整性：每条梗都能被检索到，也有话可接", () => {
  assert.ok(MEMES.length >= 30, `只收了 ${MEMES.length} 条`);

  const seen = new Set();
  for (const meme of MEMES) {
    assert.equal(typeof meme.id, "string", "id 必须是字符串");
    assert.ok(meme.id.trim(), `有条梗没有 id：${JSON.stringify(meme)}`);
    assert.ok(!seen.has(meme.id), `id 重复：${meme.id}`);
    seen.add(meme.id);

    assert.ok(Array.isArray(meme.keys) && meme.keys.length > 0, `${meme.id} 没有 keys`);
    for (const key of meme.keys) assert.ok(String(key ?? "").trim(), `${meme.id} 有空 key`);

    assert.ok(KINDS.has(meme.kind), `${meme.id} 的 kind 不在允许集合：${meme.kind}`);
    assert.ok(String(meme.read ?? "").trim(), `${meme.id} 没有 read`);
    assert.ok(String(meme.reply ?? "").trim(), `${meme.id} 没有 reply`);

    assert.ok(ids(meme.keys[0]).includes(meme.id), `主键「${meme.keys[0]}」找不到 ${meme.id}`);
  }
});

test("缩写：大小写照认，YYDS 也是 yyds", () => {
  assert.deepEqual(ids("yyds"), ["yyds"]);
  assert.deepEqual(ids("YYDS"), ["yyds"]);
  assert.deepEqual(ids("永远的神"), ["yyds"]);
  assert.deepEqual(ids("这波操作 Yyds"), ["yyds"]);
});

test("中文：按子串认，笑死我了 就是 xswl", () => {
  assert.deepEqual(ids("笑死我了"), ["xswl"]);
  assert.deepEqual(ids("真的笑死我了哈哈哈哈"), ["xswl"]);
});

test("没梗的句子：一条都不给", () => {
  assert.deepEqual(matchMemes("今天地铁很挤，晚饭吃了面。"), []);
  assert.deepEqual(matchMemes("字典里没有这个词"), []);
  assert.deepEqual(matchMemes(""), []);
  assert.deepEqual(matchMemes(null), []);
});

test("排序：一句话里两个梗，分数高的在前", () => {
  assert.deepEqual(ids("笑死我了，有点破防"), ["xswl", "pofang"]);
});

test("limit：给几条就几条", () => {
  const text = "笑死我了，有点破防，鼠鼠我啊";
  assert.equal(matchMemes(text).length, MEME_LIMIT);
  assert.deepEqual(ids(text, { limit: 1 }), ["xswl"]);
  assert.deepEqual(matchMemes(text, { limit: 0 }), []);
});

test("extra：调用方临时塞的卡也能命中", () => {
  const extra = [{ id: "moyu", keys: ["摸鱼"], kind: "行为", read: "偷懒", reply: "笑一句" }];
  assert.deepEqual(ids("又在摸鱼"), []);
  assert.deepEqual(ids("又在摸鱼", { extra }), ["moyu"]);

  const block = memeBlock("又在摸鱼", { extra });
  assert.ok(block.includes("摸鱼"));
  assert.ok(block.includes("偷懒"));
});

test("memeBlock：没命中就是空串，不占 token", () => {
  assert.equal(memeBlock("今天地铁很挤，晚饭吃了面。"), "");
  assert.equal(memeBlock(""), "");
});

test("memeBlock：只给方向，不把 read 复述成释义", () => {
  const block = memeBlock("YYDS");
  assert.ok(block.includes("yyds"), "要带上被命中的说法");
  assert.ok(block.includes("别当字面意思接"));
  assert.ok(block.includes("他先用"));
  assert.ok(!block.includes("意思是"), "别把 read 讲成「意思是……」");

  const yyds = MEMES.find((meme) => meme.id === "yyds");
  assert.ok(block.includes(yyds.read), "read 要原样带上");
  assert.ok(block.includes(yyds.reply), "reply 要原样带上");
});

test("确定性：同样的输入，同样的结果", () => {
  const extra = [{ id: "moyu", keys: ["摸鱼"], kind: "行为", read: "偷懒", reply: "笑一句" }];
  const text = "YYDS，笑死我了，有点破防";
  assert.deepEqual(matchMemes(text, { extra }), matchMemes(text, { extra }));
  assert.equal(memeBlock(text, { extra }), memeBlock(text, { extra }));
});
