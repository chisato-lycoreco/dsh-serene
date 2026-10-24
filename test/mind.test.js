import test from "node:test";
import assert from "node:assert/strict";
import { applyEvidence, beliefsLine, mergeBeliefs, normalizeBeliefs } from "../core/beliefs.js";
import { DIMENSION_KEYS, observe, profileLine, profileSummary } from "../core/profile.js";
import { dueForReflection, inNightWindow, nightKey, reflect } from "../core/introspect.js";

const now = Date.parse("2026-10-24T12:40:00Z");

test("看法：坏种子丢掉，好的收成标准形状", () => {
  const list = normalizeBeliefs([
    { topic: "安静比热闹好", stance: 0.8, confidence: 0.7, evidence: 3 },
    { topic: "", stance: 1 },
    { topic: "没立场", stance: "很信" },
    { topic: "安静比热闹好", stance: -1 },
    null,
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].topic, "安静比热闹好");
  assert.equal(list[0].stance, 0.8);
  assert.equal(list[0].evidence, 3);
});

test("一次事件会把已有的看法挪一点，但不会被一句话翻面", () => {
  const seed = [{ topic: "安静比热闹好", stance: 0.8, confidence: 0.75, evidence: 2 }];
  const first = applyEvidence(seed, { topic: "安静比热闹好", stance: 0, weight: 1, now });
  assert.equal(first.changed, true);
  assert.ok(first.belief.stance < 0.8 && first.belief.stance > 0.4, `一次就挪到 ${first.belief.stance}`);
  assert.ok(first.belief.confidence > 0.75, "被说动一次也会更确定自己听过");

  const second = applyEvidence(first.beliefs, { topic: "安静比热闹好", stance: 0, weight: 2, now: now + 1000 });
  assert.ok(second.belief.stance < first.belief.stance, "再说一次会更靠过去");

  // 反向的一次事件不会把立场直接推翻，只会拉回来一点。
  const third = applyEvidence(seed, { topic: "安静比热闹好", stance: -1, weight: 1, now: now + 2000 });
  assert.ok(third.belief.stance > 0, `不该翻面：${third.belief.stance}`);
});

test("没听过的看法：记下来，底气比种子低", () => {
  const result = applyEvidence([], { topic: "雨声让人安心", stance: 0.6, now });
  assert.equal(result.belief.stance, 0.6);
  assert.ok(result.belief.confidence < 0.6, "第一次听说的，不该像老看法一样有底气");
  const empty = applyEvidence([], { topic: "没有立场", now });
  assert.equal(empty.changed, false);
});

test("只重复听到、不给立场：底气变足，立场不动", () => {
  const first = applyEvidence([], { topic: "海很吵", stance: 0.3, now });
  const again = applyEvidence(first.beliefs, { topic: "海很吵", now: now + 1 });
  assert.equal(again.belief.stance, first.belief.stance);
  assert.ok(again.belief.confidence > first.belief.confidence);
});

test("种子和学到的合并：同一个话题以学到的为准", () => {
  const merged = mergeBeliefs(
    [{ topic: "安静比热闹好", stance: 0.8, confidence: 0.75 }],
    [{ topic: "安静比热闹好", stance: -0.2, confidence: 0.5 }, { topic: "旧东西值得留着", stance: 0.6, confidence: 0.4 }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.topic === "安静比热闹好").stance, -0.2);
  assert.match(beliefsLine(merged), /旧东西值得留着/);
  assert.equal(beliefsLine([]), "");
  assert.equal(beliefsLine([{ topic: "拿不准", stance: 0.9, confidence: 0.2 }]), "");
});

test("用户模型：空种子什么都写不出来", () => {
  assert.equal(profileLine([]), "");
  assert.equal(profileSummary([]).length, 0);
  const empty = observe([], { dimension: "rhythm", value: "  ", now });
  assert.equal(empty.changed, false);
  assert.equal(empty.reason, "value");
});

test("用户模型：同一件事再看到一次更确定，不同的事按维度留三条", () => {
  const first = observe([], { dimension: "rhythm", value: "他睡得晚", now });
  assert.equal(first.observation.count, 1);
  const again = observe(first.profile, { dimension: "rhythm", value: "他睡得晚", now: now + 1 });
  assert.equal(again.observation.count, 2);
  assert.ok(again.observation.confidence > first.observation.confidence);

  let list = again.profile;
  let last = null;
  for (const value of ["他起得也晚", "他周末补觉", "他下午会困"]) {
    last = observe(list, { dimension: "rhythm", value, now: now + 2 });
    list = last.profile;
  }
  const rhythm = profileSummary(list).find((item) => item.dimension === "rhythm");
  assert.equal(rhythm.count, 3, "一个维度最多留三条");
  assert.equal(last.changed, false);
  assert.equal(last.reason, "crowded", "排不进前三的观察不假装记下");
  assert.match(profileLine(list), /你注意到：/);
});

test("用户模型：不认识的维度直接拒绝", () => {
  const result = observe([], { dimension: "血型", value: "O" });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "dimension");
  assert.deepEqual(DIMENSION_KEYS, ["rhythm", "taste", "matters", "talk", "mood", "weather"]);
});

test("自省只在夜里，一晚只算一次", () => {
  const late = Date.parse("2026-10-24T15:30:00Z"); // 北京 23:30
  assert.equal(inNightWindow(late), true);
  assert.equal(nightKey(late), "2026-10-24");
  assert.equal(dueForReflection(late, ""), true);
  assert.equal(dueForReflection(late, "2026-10-24"), false);

  const smallHours = Date.parse("2026-10-24T17:30:00Z"); // 北京次日 01:30
  assert.equal(inNightWindow(smallHours), true);
  assert.equal(nightKey(smallHours), "2026-10-24", "凌晨还算前一晚");

  assert.equal(inNightWindow(Date.parse("2026-10-24T18:00:00Z")), false); // 北京 02:00
  assert.equal(inNightWindow(now), false);
});

test("自省只收拢已有的东西，没有素材就不写", () => {
  assert.deepEqual(reflect({ now }), { text: "", lines: [] });

  const result = reflect({
    now,
    snapshot: { backgroundLabel: "松", primaryLabel: "静" },
    memories: [{ text: "他借了一本书" }, { text: "外面下雨了" }],
    beliefs: [{ topic: "被认真听完比被夸难得", stance: 0.8, confidence: 0.7 }],
    profile: [{ dimension: "rhythm", value: "他睡得晚", confidence: 0.5 }],
  });
  assert.match(result.text, /【夜里】/);
  assert.match(result.text, /今天你记下的：他借了一本书；外面下雨了/);
  assert.match(result.text, /底色是松/);
  assert.match(result.text, /被认真听完比被夸难得/);
  assert.match(result.text, /他睡得晚/);
  assert.equal(result.lines.length, 4);
});
