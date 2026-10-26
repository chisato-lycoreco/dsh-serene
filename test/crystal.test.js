import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_BUDGET,
  DISPOSITION_BODY_MAX,
  LESSON_LINE_MAX,
  MAX_DISPOSITIONS,
  MAX_LESSONS,
  capDispositions,
  capLessons,
  crystalBlock,
  dispositionIssues,
  isDispositionReady,
  isLessonReady,
  isPlatitude,
  lessonIssues,
  normalizeCrystals,
  normalizeDisposition,
  normalizeLesson,
  promoteLesson,
  renderDispositions,
  renderLesson,
  retireDisposition,
  retireLesson,
  reviseDisposition,
  reviseLesson,
  revokeDisposition,
  selectLesson,
} from "../core/crystal.js";

const NOW = Date.parse("2026-10-26T12:00:00+08:00");

function lesson(overrides = {}) {
  return normalizeLesson(
    {
      id: "ls_busy_wait",
      situation: "他说马上，人还在忙",
      did: "没催，只问要不要把事挪到明天",
      outcome: "十分钟后他自己收了",
      result: "worked",
      next: "先等十分钟，再问要不要挪",
      counter: "他明确说今天必须做完时，别等，直接问卡在哪",
      when: ["马上", "在忙", "没回"],
      evidence: ["m_1001", "m_1002"],
      confidence: 0.6,
      ownerApproved: true,
      ...overrides,
    },
    { now: NOW },
  );
}

function disposition(overrides = {}) {
  return normalizeDisposition(
    {
      id: "dp_watch_do",
      text: "先看他做了什么，再听他说了什么",
      because: "说想早睡，到点真走了；嘴上说没事，第二天还是没来",
      limit: "他明确开口要什么时，先信那句话，别拿行为去驳他",
      evidence: ["m_1001", "m_1002", "m_1003"],
      since: NOW - 10_000,
      ownerApproved: true,
      ...overrides,
    },
    { now: NOW },
  );
}

test("口号：主语可以随便换的，过不了陌生人闸门", () => {
  assert.equal(isPlatitude(""), true);
  assert.equal(isPlatitude("沟通很重要"), true);
  assert.equal(isPlatitude("要学会理解对方"), true);
  assert.equal(isPlatitude("时间会证明一切"), true);
  assert.equal(isPlatitude("只要多陪陪他就会好起来"), true);
  assert.equal(isPlatitude("他说马上，人还在忙；我没催，十分钟后他自己收了"), false);
});

test("经验：形状固定、id 稳定、坏值不抛", () => {
  const one = lesson();
  assert.equal(one.id, "ls_busy_wait");
  assert.equal(one.result, "worked");
  assert.deepEqual(one.when, ["马上", "在忙", "没回"]);
  assert.equal(one.evidence.length, 2);
  assert.equal(one.createdAt, NOW);

  const generated = normalizeLesson(
    { situation: "他半夜说饿", did: "没讲道理，去煮了面", outcome: "他吃完了", next: "先煮面", counter: "他刚吃过就别煮", evidence: ["a", "b"] },
    { now: NOW },
  );
  const again = normalizeLesson(generated, { now: NOW });
  assert.equal(generated.id, again.id, "同样的内容反复规整，id 不变");

  const bad = normalizeLesson({ result: "大成功", confidence: 9, evidence: "不是数组" }, { now: NOW });
  assert.equal(bad.result, "mixed");
  assert.equal(bad.confidence, 0.95);
  assert.deepEqual(bad.evidence, []);
});

test("三道闸门：缺证据、缺反证、口号都进不了 prompt", () => {
  assert.deepEqual(lessonIssues({}), ["incomplete", "no_outcome", "no_next", "no_evidence", "no_counter"]);
  assert.ok(lessonIssues({ ...lesson(), evidence: ["m_1"] }).includes("no_evidence"));
  assert.ok(lessonIssues({ ...lesson(), counter: "" }).includes("no_counter"));
  assert.ok(lessonIssues({ ...lesson(), ownerApproved: false, did: "沟通很重要" }).includes("platitude"));
  assert.equal(isLessonReady(lesson()), true);
  assert.equal(isLessonReady(lesson({ ownerApproved: false, did: "要学会沟通" })), false);
  assert.equal(isLessonReady(lesson({ ownerApproved: true, did: "要学会沟通" })), true, "owner 审过可以破例");

  const long = lesson({ next: "长".repeat(51) });
  assert.ok(lessonIssues({ ...long, next: "长".repeat(51) }).includes("too_long"));
});

test("挑经验：触发词优先，挑不到就空着，不硬塞", () => {
  const busy = lesson();
  const food = lesson({
    id: "ls_food",
    situation: "他半夜说饿",
    did: "没讲道理，去煮了面",
    outcome: "他吃完了",
    next: "先煮面",
    counter: "他刚吃过就别煮",
    when: ["饿", "夜宵"],
    evidence: ["m_2001", "m_2002"],
    confidence: 0.5,
  });
  assert.equal(selectLesson([busy, food], { cue: "我还在忙，马上" })?.id, "ls_busy_wait");
  assert.equal(selectLesson([busy, food], { cue: "有点饿" })?.id, "ls_food");
  assert.equal(selectLesson([busy, food], { cue: "今天天气不错" }), null);
  assert.equal(selectLesson([busy, food], { cue: "" }), null);
  assert.equal(selectLesson([busy], { cue: "在忙" })?.id, "ls_busy_wait");
});

test("挑经验：retired 不进；同分先信置信度，再按 id 定序", () => {
  const a = lesson({ id: "ls_a", when: ["同款"], confidence: 0.5 });
  const b = lesson({ id: "ls_b", when: ["同款"], confidence: 0.7 });
  assert.equal(selectLesson([a, b], { cue: "同款" })?.id, "ls_b");
  const c = lesson({ id: "ls_c", when: ["同款"], confidence: 0.7 });
  assert.equal(selectLesson([b, c], { cue: "同款" })?.id, "ls_b");
  assert.equal(selectLesson([retireLesson(a)], { cue: "同款" }), null);
});

test("渲染经验：像回忆，不像结论；一行有上限", () => {
  const line = renderLesson(lesson());
  assert.match(line, /^- 上回这种时候：他说马上，人还在忙；我没催/);
  assert.match(line, /十分钟后他自己收了。下回先等十分钟，再问要不要挪。/);
  assert.ok([...line].length <= LESSON_LINE_MAX);

  const long = renderLesson(lesson({ situation: "很长".repeat(30), did: "也很长".repeat(30), outcome: "长".repeat(40), next: "长".repeat(40) }));
  assert.ok([...long].length <= LESSON_LINE_MAX);
  assert.ok(long.endsWith("…"));
});

test("想事情的路子：证据要三条，limit 不能省，口号不收", () => {
  const one = disposition();
  assert.equal(one.text, "先看他做了什么，再听他说了什么");
  assert.equal(one.evidence.length, 3);
  assert.equal(isDispositionReady(one), true);
  assert.ok(dispositionIssues({ ...one, evidence: ["a", "b"] }).includes("no_evidence"));
  assert.ok(dispositionIssues({ ...one, limit: "" }).includes("no_limit"));
  assert.ok(dispositionIssues({ ...one, ownerApproved: false, text: "要学会理解" }).includes("platitude"));
  assert.equal(isDispositionReady({ ...one, text: "要学会理解", ownerApproved: true }), true);
});

test("渲染想事情的路子：头部写清「不是台词」，正文不超预算", () => {
  const list = [
    disposition({ id: "dp_1", since: 2 }),
    disposition({ id: "dp_2", since: 1, text: "话不说满，能给几分说几分" }),
    disposition({ id: "dp_3", since: 3, status: "retired" }),
  ];
  const text = renderDispositions(list);
  assert.match(text, /^你平时想事情的路子（不是台词，不问就不提，他真问起才认）：/);
  assert.match(text, /话不说满/);
  assert.doesNotMatch(text, /说想早睡/);
  assert.ok(text.split("\n")[1].length <= DISPOSITION_BODY_MAX);
  assert.equal(renderDispositions([]), "");
});

test("合成一块：没有经验时只留想事情的路子；有触发词才多一条经验", () => {
  const data = { lessons: [lesson()], dispositions: [disposition()] };
  assert.match(crystalBlock(data, { cue: "还在忙吗" }), /你自己试出来的一件事/);
  assert.match(crystalBlock(data, { cue: "还在忙吗" }), /你平时想事情的路子/);
  const noCue = crystalBlock(data);
  assert.doesNotMatch(noCue, /你自己试出来的一件事/);
  assert.match(noCue, /你平时想事情的路子/);
  assert.equal(crystalBlock({ lessons: [], dispositions: [] }), "");
  const block = crystalBlock(data, { cue: "还在忙吗" });
  assert.ok([...block].length <= BLOCK_BUDGET + 80, `块不该失控：${block.length}`);
});

test("验证一次：命中 +1，置信度小步上调，但封在 0.9", () => {
  const first = promoteLesson(lesson({ confidence: 0.88 }), { evidence: ["m_1003", "m_1001"], now: NOW + 1 });
  assert.equal(first.hits, 1);
  assert.equal(first.lastHit, NOW + 1);
  assert.equal(first.confidence, 0.9);
  assert.deepEqual(first.evidence, ["m_1001", "m_1002", "m_1003"], "证据去重，不重复记");
  const second = promoteLesson(first, { now: NOW + 2 });
  assert.equal(second.confidence, 0.9, "不会涨成「我永远对」");
});

test("修订：旧版本留账，id 和 createdAt 不动", () => {
  const before = lesson();
  const after = reviseLesson(before, { outcome: "他二十分钟后才收", next: "先等二十分钟" }, { now: NOW + 100 });
  assert.equal(after.id, before.id);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.outcome, "他二十分钟后才收");
  assert.equal(after.history.length, 1);
  assert.equal(after.history[0].outcome, "十分钟后他自己收了");
  assert.equal(after.history[0].at, NOW + 100);
});

test("淘汰与撤销：不删，标状态", () => {
  const retired = retireLesson(lesson(), "过时了");
  assert.equal(retired.status, "retired");
  assert.equal(retired.retiredReason, "过时了");

  const revised = reviseDisposition(disposition(), { text: "先看他做了什么" }, { now: NOW + 1 });
  assert.equal(revised.text, "先看他做了什么");
  assert.equal(revised.revisions.length, 1);
  assert.equal(retireDisposition(revised, "不适用了").status, "retired");
  const revoked = revokeDisposition(revised, "晋错了", { now: NOW + 2 });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokedAt, NOW + 2);
});

test("上限：超过 20 条先淘汰 retired 和低置信的；想事情的路子留 8 条", () => {
  const many = Array.from({ length: MAX_LESSONS + 5 }, (_, index) =>
    lesson({ id: `ls_${String(index).padStart(2, "0")}`, confidence: index / 100, createdAt: NOW + index }),
  );
  const capped = capLessons(many);
  assert.equal(capped.length, MAX_LESSONS);
  assert.ok(capped.every((item) => item.status === "active"));
  assert.ok(capped.some((item) => item.id === `ls_${String(MAX_LESSONS + 4).padStart(2, "0")}`), "高置信的留下");

  const withRetired = capLessons([
    lesson({ id: "ls_retired", status: "retired", confidence: 0.95 }),
    lesson({ id: "ls_active", confidence: 0.2 }),
  ]);
  assert.equal(withRetired[0].id, "ls_active", "active 优先于 retired");

  const dispositions = Array.from({ length: MAX_DISPOSITIONS + 3 }, (_, index) =>
    disposition({ id: `dp_${index}`, since: index }),
  );
  assert.equal(capDispositions(dispositions).length, MAX_DISPOSITIONS);
});

test("人格种子：规整、过滤坏形状、各自封顶", () => {
  const seeds = normalizeCrystals({
    lessons: Array.from({ length: MAX_LESSONS + 2 }, (_, index) => ({
      id: `ls_${index}`,
      situation: `情形 ${index}`,
      did: "做了点具体的事",
      outcome: "有结果",
      next: "下回照做",
      counter: "不适用时别照做",
      evidence: ["a", "b"],
      confidence: 0.5,
    })),
    dispositions: Array.from({ length: MAX_DISPOSITIONS + 2 }, (_, index) => ({
      id: `dp_${index}`,
      text: `想事情的路子 ${index}`,
      because: "见过三次",
      limit: "不适用时别用",
      evidence: ["a", "b", "c"],
      since: index,
    })),
  });
  assert.equal(seeds.lessons.length, MAX_LESSONS);
  assert.equal(seeds.dispositions.length, MAX_DISPOSITIONS);
  assert.equal(seeds.lessons[0].source, "persona");
  assert.deepEqual(normalizeCrystals(null), { lessons: [], dispositions: [] });
});
