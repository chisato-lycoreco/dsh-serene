import test from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE,
  adaptationGain,
  advance,
  applyEventToLayers,
  beijingMinuteOfDay,
  circadian,
  classifyMessage,
  deriveBaseline,
  describeLayers,
  emotionBlock,
  moodOf,
  normalizeLayers,
  proactiveGap,
  woundDepth,
} from "../core/emotion.js";

const T0 = Date.parse("2026-10-24T12:00:00+08:00");

test("确定性：同样的初始状态 + 事件 + 时间，得到同样的结果", () => {
  const base = normalizeLayers({});
  const once = advance(applyEventToLayers(base, "affection"), { from: T0, to: T0 + 3 * 3600_000 });
  const twice = advance(applyEventToLayers(normalizeLayers({}), "affection"), { from: T0, to: T0 + 3 * 3600_000 });
  assert.deepEqual(once, twice);
});

test("衰减：初级层比底色回落得快", () => {
  const base = normalizeLayers({});
  const pushed = applyEventToLayers(base, "affection");
  const primary = pushed.primary.pleasure - base.primary.pleasure;
  const background = pushed.background.pleasure - base.background.pleasure;
  assert.ok(primary > background, "事件先推动初级层");

  const later = advance(pushed, { from: T0, to: T0 + 2 * 3600_000 });
  const keepPrimary = (later.primary.pleasure - base.primary.pleasure) / primary;
  const keepBackground = (later.background.pleasure - base.background.pleasure) / background;
  assert.ok(keepPrimary < keepBackground, "两小时后初级层保留得更少");
});

test("享乐适应：同一维越高，正向事件打进来越少", () => {
  assert.ok(adaptationGain("pleasure", 90) < adaptationGain("pleasure", 70));
  assert.ok(adaptationGain("pleasure", 99) < adaptationGain("pleasure", 90));
  assert.equal(adaptationGain("arousal", 99), 1, "未配置饱和的维度不打折");
});

test("疤：只往下挪，且总位移封顶", () => {
  const once = deriveBaseline(BASELINE, [{ depth: 3 }]);
  assert.ok(once.primary.pleasure < BASELINE.primary.pleasure);
  const many = deriveBaseline(BASELINE, Array.from({ length: 20 }, () => ({ depth: 3 })));
  assert.ok(many.primary.pleasure >= BASELINE.primary.pleasure - 12 - 0.001, "封顶生效");
  assert.ok(many.primary.connection >= BASELINE.primary.connection - 14 - 0.001);
});

test("留疤门槛：说死话比普通冲突更容易", () => {
  assert.equal(woundDepth(-10, "你怎么这么慢"), 0);
  assert.equal(woundDepth(-10, "我们分手吧"), 1);
  assert.equal(woundDepth(-30, "算了"), 2);
  assert.equal(woundDepth(-24, "别再找我了"), 3);
});

test("昼夜节律：深夜唤醒更低，睡眠再降一档", () => {
  const night = circadian(3);
  const morning = circadian(10);
  assert.ok(night.arousal < morning.arousal);
  assert.ok(circadian(3, true).arousal < night.arousal);
});

test("情绪改判：底色低时中性话被读冷", () => {
  const low = normalizeLayers({});
  for (const layer of ["background", "primary", "social"]) {
    low[layer].pleasure = 30;
    low[layer].connection = 30;
    low[layer].confidence = 34;
  }
  const high = normalizeLayers({});
  for (const layer of ["background", "primary", "social"]) {
    high[layer].pleasure = 88;
    high[layer].connection = 88;
    high[layer].confidence = 82;
  }
  assert.ok(moodOf(low) < moodOf(high));
  const cold = classifyMessage({ text: "嗯。" }, { layers: low });
  assert.ok(cold, "低底色下会对很短的回应有反应");
  assert.equal(cold.kind, "cold_read");
});

test("分类：问题 / 称呼 / 空消息", () => {
  const layers = normalizeLayers({});
  assert.equal(classifyMessage({ text: "在吗" }, { layers }).kind, "question");
  assert.equal(classifyMessage({ text: "小满，早" }, { layers, lexicon: { address: ["小满"] } }).kind, "address");
  assert.equal(classifyMessage({ text: "   " }, { layers }), null);
  assert.equal(classifyMessage({ text: "你好", from: "her" }, { layers }), null, "只处理对方发来的");
});

test("描述与主动性间隔：给的是人话和毫秒，不是裸数字", () => {
  const layers = normalizeLayers({});
  const described = describeLayers(layers);
  assert.ok(described.label && described.tone && described.advice);
  const block = emotionBlock({ ...described, wounds: [], reading: null });
  assert.match(block, /情/);
  assert.doesNotMatch(block, /\b\d{2,3}\b/, "prompt 里不出现 0~100 的原始数值");

  const gap = proactiveGap(layers);
  assert.ok(gap >= 12 * 60_000 && gap <= 75 * 60_000);
});

test("北京时间换算：正午落在第 720 分钟", () => {
  assert.equal(beijingMinuteOfDay(Date.parse("2026-10-24T12:00:00+08:00")), 720);
  assert.equal(beijingMinuteOfDay(Date.parse("2026-10-24T00:30:00+08:00")), 30);
});
