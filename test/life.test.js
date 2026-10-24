import test from "node:test";
import assert from "node:assert/strict";
import { dayTimeline, energyAt, lifeAt, lifeBlock, normalizeRoutine, timePhrase } from "../core/life.js";

const at = (iso) => Date.parse(iso);
const workday = at("2026-10-23T10:00:00+08:00");
const weekend = at("2026-10-24T10:00:00+08:00");
const lateNight = at("2026-10-24T02:00:00+08:00");

test("确定性：同一时刻，同一段话", () => {
  assert.equal(lifeBlock(lifeAt(workday)), lifeBlock(lifeAt(workday)));
  assert.equal(lifeAt(workday).activity, lifeAt(workday).activity);
});

test("工作日和周末用两套作息", () => {
  assert.equal(lifeAt(workday).weekend, false);
  assert.equal(lifeAt(weekend).weekend, true);
  assert.notEqual(lifeAt(workday).activity, lifeAt(weekend).activity);
});

test("「同一天重跑一百次都一样，今天和明天不一样」", () => {
  const tomorrow = workday + 86_400_000;
  const today = new Set(Array.from({ length: 20 }, (_, index) => lifeAt(workday + index * 60_000).activity));
  assert.equal(today.size, 1);
  assert.ok(lifeAt(workday).key !== lifeAt(tomorrow).key);
});

test("深夜是睡着的，早上是醒的", () => {
  assert.equal(lifeAt(lateNight).asleep, true);
  assert.equal(lifeAt(at("2026-10-24T08:30:00+08:00")).asleep, false);
  assert.ok(energyAt(lifeAt(lateNight)) < 0.2);
});

test("时间短语是人话，不是时间戳", () => {
  const phrase = timePhrase(lifeAt(at("2026-10-24T21:20:00+08:00")));
  assert.match(phrase, /周六/);
  assert.match(phrase, /晚上九点二十/);
  assert.doesNotMatch(phrase, /21/);
});

test("人格作息：换了 routine，就按她的过", () => {
  const routine = {
    weekday: [{ from: 0, to: 1440, phase: "terminal", place: "终端里", variants: ["在听底噪"] }],
    weekend: [{ from: 0, to: 1440, phase: "terminal", place: "终端里", asleep: true, variants: ["把功耗调低"] }],
  };
  assert.equal(lifeAt(workday, { routine }).activity, "在听底噪");
  assert.equal(lifeAt(workday, { routine }).place, "终端里");
  assert.equal(lifeAt(weekend, { routine }).asleep, true);
});

test("人格作息写坏了：坏槽位丢掉，整张表空了就回落默认", () => {
  const routine = normalizeRoutine({
    weekday: [
      { from: -5, to: 60, variants: ["在整理旧录音"] },
      { from: "x", to: 100, variants: ["坏的"] },
      { from: 60, to: 60, variants: [] },
    ],
  });
  assert.equal(routine.weekday.length, 1);
  assert.equal(routine.weekday[0].from, 0);
  assert.ok(routine.weekend.length > 0, "没给 weekend 就补默认");
  assert.ok(normalizeRoutine({ weekday: [] }).weekday.length > 0);
});

test("时间线：覆盖整天、首尾相接、时段是递增的", () => {
  const timeline = dayTimeline(workday);
  assert.equal(timeline[0].from, workday - (10 * 60) * 60_000);
  assert.equal(timeline.at(-1).to - timeline[0].from, 86_400_000);
  for (let index = 1; index < timeline.length; index += 1) {
    assert.equal(timeline[index].from, timeline[index - 1].to);
  }
});
