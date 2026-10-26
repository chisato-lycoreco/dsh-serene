import test from "node:test";
import assert from "node:assert/strict";
import {
  KINDS,
  MOVIES,
  SPANS,
  __test__,
  finishedOf,
  leisureBlock,
  leisureLabel,
  leisureLine,
  normalizeKind,
  pickMovie,
  runtimeOf,
  spanMinutes,
  trimOverlaps,
} from "../core/leisure.js";

const NOW = Date.parse("2026-10-26T21:00:00+08:00");
const MINUTE = 60_000;

test("档位是真的：四类消遣都落在自己的区间里", () => {
  assert.deepEqual(SPANS.video, [8, 25]);
  assert.deepEqual(SPANS.music, [12, 40]);
  assert.deepEqual(SPANS.game, [25, 70]);
  assert.deepEqual(SPANS.book, [20, 55]);

  for (const kind of ["video", "music", "game", "book"]) {
    const [min, max] = SPANS[kind];
    const seen = new Set();
    for (let seed = 0; seed < 60; seed += 1) {
      const minutes = spanMinutes(kind, seed);
      assert.ok(Number.isInteger(minutes), `${kind}/${seed} 是整数`);
      assert.ok(minutes >= min && minutes <= max, `${kind}/${seed} = ${minutes}，落在 ${min}-${max}`);
      seen.add(minutes);
    }
    assert.ok(seen.size > 1, `${kind} 不是永远同一个数`);
  }
});

test("片单：至少十部、片长是真的", () => {
  assert.ok(MOVIES.length >= 10);
  assert.equal(new Set(MOVIES.map((movie) => movie.title)).size, MOVIES.length, "没有重复的片");
  for (const movie of MOVIES) {
    assert.ok(movie.title.trim().length > 0);
    assert.ok(Number.isInteger(movie.runtime) && movie.runtime >= 40 && movie.runtime <= 260, `${movie.title} 片长`);
    assert.ok(Number.isInteger(movie.year) && movie.year > 1900 && movie.year < 2100, `${movie.title} 年份`);
  }
  assert.equal(MOVIES.find((movie) => movie.title === "海上钢琴师").runtime, 165);
  assert.equal(MOVIES.find((movie) => movie.title === "千与千寻").runtime, 125);
  assert.equal(runtimeOf({ runtime: 165 }), 165);
  assert.equal(runtimeOf({}), 95, "没写片长按 95 兜底");
  assert.equal(runtimeOf(null), 95);
});

test("电影按真实片长：坐得比片长多不可能", () => {
  const runtime = 165;
  for (const seed of [0, 1, 2, 5, 7, 11, 42, 99]) {
    const span = spanMinutes("movie", seed, { runtime });
    assert.ok(span <= runtime, `只坐了 ${span}，片长 ${runtime}`);
    assert.ok(span >= Math.round(runtime * 0.55), `${span} 至少要坐 55%`);
  }
  // 片长更长，坐的那段也该更长（同一个 seed，同一个比例）
  assert.ok(spanMinutes("movie", 7, { runtime: 200 }) > spanMinutes("movie", 7, { runtime: 100 }));
});

test("看不完就只算坐着的那段：没坐满的不许判看完", () => {
  const runtime = 165;
  const spans = Array.from({ length: 12 }, (_, seed) => spanMinutes("movie", seed, { runtime }));
  assert.ok(spans.some((minutes) => minutes < runtime));
  const half = spans.find((minutes) => minutes < runtime * 0.98);
  assert.ok(half, "总有一段是没坐满的");
  assert.equal(finishedOf("movie", half, { runtime }), false);
  assert.equal(finishedOf("movie", runtime, { runtime }), true);
});

test("finishedOf 的 0.98 边界", () => {
  assert.equal(finishedOf("movie", 98, { runtime: 100 }), true, "刚好 98% 算看完");
  assert.equal(finishedOf("movie", 97, { runtime: 100 }), false);
  assert.equal(finishedOf("movie", 98.0, { runtime: 100 }), true);
  assert.equal(finishedOf("movie", 97.9, { runtime: 100 }), false);
  // 默认片长 95：93 分钟差一点点，94 才算
  assert.equal(finishedOf("movie", 93, {}), false);
  assert.equal(finishedOf("movie", 94, {}), true);
  // 别的类没有片长这回事，坐够了就算看完
  assert.equal(finishedOf("video", 9), true);
  assert.equal(finishedOf("game", 30), true);
  assert.equal(finishedOf("video", 0), false, "一分钟都没坐不算看完");
});

test("三种说法：正在看 / 看完了 / 只看了一半", () => {
  assert.equal(leisureLabel("movie", "now"), "在看电影");
  assert.equal(leisureLabel("movie", "done"), "看了部电影");
  assert.equal(leisureLabel("movie", "unfinished"), "看了半部电影");
  assert.equal(leisureLabel("movie", "now", { resumed: true }), "接着看电影");
  assert.equal(leisureLabel("movie", "done", { resumed: true }), "把剩下的看完了");

  assert.equal(leisureLabel("video", "now"), "在看视频");
  assert.equal(leisureLabel("video", "done"), "看了会儿视频");
  assert.equal(leisureLabel("music", "now"), "在听歌");
  assert.equal(leisureLabel("music", "unfinished"), "听了一半");
  assert.equal(leisureLabel("game", "now"), "在打游戏");
  assert.equal(leisureLabel("book", "done"), "看了会儿书");
  assert.equal(leisureLabel("不认识", "now"), "在看视频", "认不出来的类按看视频算");
  assert.equal(normalizeKind("movie"), "movie");
  assert.equal(normalizeKind(undefined), "video");

  for (const kind of Object.keys(KINDS)) {
    assert.ok(KINDS[kind].name.length > 0);
    for (const tense of ["now", "done", "unfinished"]) assert.ok(KINDS[kind].tense[tense], `${kind}/${tense}`);
  }
});

test("trimOverlaps：后一件把前一件截到它开始的那一刻，且不改原数组", () => {
  const spans = [
    { start: 0, end: 60 },
    { start: 30, end: 90 },
    { start: 100, end: 120 },
  ];
  const snapshot = JSON.parse(JSON.stringify(spans));
  const trimmed = trimOverlaps(spans);

  assert.deepEqual(trimmed, [
    { start: 0, end: 30 },
    { start: 30, end: 90 },
    { start: 100, end: 120 },
  ]);
  assert.deepEqual(spans, snapshot, "原数组一个字段都没动");
  assert.notEqual(trimmed, spans);

  const messy = trimOverlaps([{ start: 100, end: 120 }, { start: 0, end: 60 }, { start: 30, end: 90 }]);
  assert.deepEqual(messy.map((span) => span.start), [0, 30, 100], "先按开始时间排");

  // 同一刻开始：前一段被截到长度为 0，直接丢掉
  assert.deepEqual(trimOverlaps([{ start: 10, end: 30 }, { start: 10, end: 20 }]), [{ start: 10, end: 20 }]);
  assert.deepEqual(trimOverlaps([]), []);
});

test("leisureBlock：手上、刚才、看了半部", () => {
  const movie = { kind: "movie", title: "海上钢琴师", minutes: 165, startAt: NOW, endAt: NOW + 165 * MINUTE, runtime: 165 };

  const ongoing = leisureBlock(movie, { now: NOW + 40 * MINUTE });
  assert.match(ongoing, /^【手上】/);
  assert.match(ongoing, /在看电影/);
  assert.match(ongoing, /海上钢琴师/);
  assert.match(ongoing, /已经 40 分钟/);

  const done = leisureBlock(movie, { now: NOW + 200 * MINUTE });
  assert.match(done, /^刚才/);
  assert.match(done, /看了部电影/);
  assert.match(done, /165 分钟/);
  assert.equal(leisureLine(movie, { now: NOW + 200 * MINUTE }).unfinished, false);

  const half = { ...movie, minutes: 95, endAt: NOW + 95 * MINUTE };
  const unfinished = leisureBlock(half, { now: NOW + 120 * MINUTE });
  assert.match(unfinished, /看了半部/);
  assert.doesNotMatch(unfinished, /看完了/, "没看完就不许写成看完了");
  assert.equal(leisureLine(half, { now: NOW + 120 * MINUTE }).unfinished, true);

  // 要标记的话，同一个函数 detailed 一下就有
  const detailed = leisureBlock(half, { now: NOW + 120 * MINUTE, detailed: true });
  assert.equal(detailed.unfinished, true);
  assert.equal(detailed.text, unfinished);
  assert.equal(detailed.minutes, 95);

  // 记录明说没看完，就按记录走（哪怕分钟数看着像坐满了）
  const declared = leisureBlock({ ...movie, finished: false }, { now: NOW + 200 * MINUTE });
  assert.match(declared, /看了半部/);
  assert.doesNotMatch(declared, /看完了/);

  // 没有标题就不硬加书名号；options.title 可以覆盖
  const untitled = leisureBlock({ kind: "music", minutes: 20, startAt: NOW, endAt: NOW + 20 * MINUTE }, {
    now: NOW + 30 * MINUTE,
  });
  assert.doesNotMatch(untitled, /「/);
  assert.match(leisureBlock(movie, { now: NOW + 200 * MINUTE, title: "千与千寻" }), /千与千寻/);
});

test("确定性：同一个 seed 两次一模一样", () => {
  assert.equal(spanMinutes("game", "seed-7"), spanMinutes("game", "seed-7"));
  assert.equal(spanMinutes("video", 0), spanMinutes("video", 0));
  assert.equal(spanMinutes("movie", 3, { runtime: 125 }), spanMinutes("movie", 3, { runtime: 125 }));

  const movie = { kind: "movie", title: "一一", minutes: 120, startAt: NOW, endAt: NOW + 120 * MINUTE, runtime: 173 };
  assert.equal(leisureBlock(movie, { now: NOW + 130 * MINUTE }), leisureBlock(movie, { now: NOW + 130 * MINUTE }));
  assert.equal(pickMovie(9).title, pickMovie(9).title);
  assert.ok(MOVIES.includes(pickMovie(9)));

  const values = new Set(Array.from({ length: 30 }, (_, seed) => spanMinutes("video", seed)));
  assert.ok(values.size > 1, "不同 seed 该有不同的时长");
  assert.equal(__test__.FINISHED_RATIO, 0.98);
  assert.equal(__test__.DEFAULT_RUNTIME, 95);
});
