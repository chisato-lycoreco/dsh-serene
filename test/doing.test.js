import test from "node:test";
import assert from "node:assert/strict";
import { doingBlock, doingView } from "../core/doing.js";
import { lifeAt } from "../core/life.js";

const NOW = Date.parse("2026-10-26T21:30:00+08:00");
const NIGHT = Date.parse("2026-10-26T02:00:00+08:00");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function leisureOf({ kind = "video", title = "", minutes = 20, startAt, endAt, finished = true, runtime = 0 }) {
  return { kind, title, minutes, startAt, endAt, finished, runtime };
}

test("进行中的消遣优先：作息说在收拾屋子，手上是那部电影", () => {
  const life = lifeAt(NOW);
  const leisure = [
    leisureOf({
      kind: "movie",
      title: "海上钢琴师",
      minutes: 165,
      startAt: NOW - 40 * MINUTE,
      endAt: NOW + 125 * MINUTE,
      runtime: 165,
    }),
  ];
  const view = doingView({ life, leisure, now: NOW });

  assert.equal(view.now.kind, "movie");
  assert.equal(view.now.label, "在看电影");
  assert.equal(view.now.detail, "海上钢琴师");
  assert.equal(view.before.length, 0, "手上这件不重复算进刚才");
  assert.equal(doingBlock(view), "【手上】在看电影「海上钢琴师」。");
});

test("25 分钟外的消遣不算「手上」，但带 endAt 的长片一直算", () => {
  // 没带 endAt 的老记录：过了 25 分钟就是刚放下了
  const stale = [leisureOf({ kind: "music", minutes: 20, startAt: NOW - 40 * MINUTE })];
  const view = doingView({ life: null, leisure: stale, now: NOW });
  assert.equal(view.now, null);
  assert.equal(view.before.length, 1);
  assert.equal(view.before[0].label, "听了会儿歌");

  // 带 endAt 的按它自己的时长走：一部两小时的片子不会因为过了二十五分钟就被放下
  const long = [
    leisureOf({
      kind: "movie",
      title: "一一",
      minutes: 173,
      startAt: NOW - 100 * MINUTE,
      endAt: NOW + 73 * MINUTE,
      runtime: 173,
    }),
  ];
  const longView = doingView({ life: null, leisure: long, now: NOW });
  assert.equal(longView.now.kind, "movie");
  assert.equal(longView.now.detail, "一一");
  assert.equal(longView.before.length, 0);
});

test("睡觉时说在睡", () => {
  const view = doingView({ life: lifeAt(NIGHT), leisure: [], now: NIGHT });
  assert.equal(view.now.kind, "sleep");
  assert.match(view.now.label, /睡/);
  assert.equal(doingBlock(view), "【手上】在睡觉。");

  // 人已经睡了，记录里那条还没到点的只是她本来打算看的
  const planned = [
    leisureOf({
      kind: "movie",
      title: "千与千寻",
      minutes: 125,
      startAt: NIGHT - 30 * MINUTE,
      endAt: NIGHT + 95 * MINUTE,
      runtime: 125,
    }),
  ];
  assert.equal(doingView({ life: lifeAt(NIGHT), leisure: planned, now: NIGHT }).now.kind, "sleep");
});

test("刚才：最多两条、只留四小时内、按时间倒序", () => {
  const ended = (kind, minutesAgo, id) => ({
    id,
    kind,
    title: "",
    minutes: 30,
    startAt: NOW - minutesAgo * MINUTE - 30 * MINUTE,
    endAt: NOW - minutesAgo * MINUTE,
    finished: true,
  });
  const leisure = [
    ended("music", 10, "a"),
    ended("video", 60, "b"),
    ended("book", 180, "c"),
    ended("game", 300, "d"),
    ended("movie", 360, "e"),
  ];
  const view = doingView({ life: null, leisure, now: NOW });

  assert.equal(view.now, null);
  assert.equal(view.before.length, 2);
  assert.ok(view.before[0].at > view.before[1].at, "新的在前");
  assert.ok(view.before.every((item) => NOW - item.at <= 4 * HOUR), "四小时外的不要说");
  assert.equal(view.before[0].label, "听了会儿歌");
  assert.equal(view.before[1].label, "看了会儿视频");
  assert.equal(doingBlock(view), "【刚才】听了会儿歌；看了会儿视频。");

  // 别处补进来的「刚才」也走同一道闸
  const fromElsewhere = doingView({
    life: null,
    leisure: [],
    before: [
      { label: "在收拾屋子", detail: "", at: NOW - 10 * MINUTE },
      { label: "在做饭", detail: "", at: NOW - 6 * HOUR },
    ],
    now: NOW,
  });
  assert.equal(fromElsewhere.before.length, 1);
  assert.equal(doingBlock(fromElsewhere), "【刚才】在收拾屋子。");
});

test("没看完的刚才只说看了半部", () => {
  const half = {
    id: "half",
    kind: "movie",
    title: "一一",
    minutes: 95,
    startAt: NOW - 200 * MINUTE,
    endAt: NOW - 100 * MINUTE,
    runtime: 173,
    finished: false,
  };
  const view = doingView({ life: null, leisure: [half], now: NOW });
  assert.equal(view.before[0].label, "看了半部电影");
  assert.doesNotMatch(doingBlock(view), /看完了/);
});

test("空输入返回空串；now 必须传", () => {
  const view = doingView({ life: null, leisure: [], before: [], now: NOW });
  assert.deepEqual(view, { now: null, before: [] });
  assert.equal(doingBlock(view), "");
  assert.equal(doingBlock(null), "");
  assert.equal(doingBlock({ now: null, before: [] }), "");

  assert.throws(() => doingView({ life: null, leisure: [] }), /now/);
});

test("用作息说此刻：label / detail 都对得上 lifeAt", () => {
  const life = lifeAt(NOW);
  const view = doingView({ life, now: NOW });
  assert.equal(view.now.kind, "life");
  assert.equal(view.now.label, life.activity);
  assert.equal(view.now.detail, life.place);
  assert.match(doingBlock(view), /^【手上】/);
});

test("纯函数：同样的输入，同样的输出（不看时钟）", () => {
  const life = lifeAt(NOW);
  const leisure = [
    leisureOf({ kind: "game", title: "", minutes: 40, startAt: NOW - 10 * MINUTE, endAt: NOW + 30 * MINUTE }),
  ];
  assert.deepEqual(doingView({ life, leisure, now: NOW }), doingView({ life, leisure, now: NOW }));
  assert.deepEqual(
    doingView({ life, leisure, now: NOW - 8 * HOUR }).now,
    doingView({ life, leisure, now: NOW - 8 * HOUR }).now,
  );
});
