import test from "node:test";
import assert from "node:assert/strict";
import { PROACTIVE, commit, decide, intent, normalizeState, reject } from "../core/motivation.js";
import { normalizeLayers } from "../core/emotion.js";

const T0 = Date.parse("2026-10-24T12:00:00+08:00");
const MIN = 60_000;
const HOUR = 60 * MIN;
const layers = normalizeLayers({});

const check = (overrides = {}) =>
  decide({ now: T0, layers, lastInteractionAt: T0 - 24 * HOUR, state: {}, ...overrides });

test("意图：刚聊完几乎不想说话，隔一天会自己涨上来", () => {
  const justTalked = intent(layers, { now: T0, lastInteractionAt: T0 });
  const aDayAway = intent(layers, { now: T0, lastInteractionAt: T0 - 24 * HOUR });
  assert.ok(justTalked < PROACTIVE.minIntent);
  assert.ok(aDayAway > justTalked);
});

test("该开口的时候真的开口：默认状态过得了所有门", () => {
  const decision = check();
  assert.equal(decision.act, true);
  assert.equal(decision.reason, "ok");
  assert.equal(decision.budget.limit, 3);
  assert.equal(decision.budget.used, 0);
});

test("预算：一天 3 次，用完就停，不会自己加额度", () => {
  let state = {};
  for (let i = 0; i < 3; i += 1) state = commit(state, { now: T0 + i * 90 * MIN });
  assert.equal(state.today.count, 3);
  const decision = decide({ now: T0 + 5 * HOUR, layers, lastInteractionAt: T0 - 24 * HOUR, state });
  assert.equal(decision.act, false);
  assert.equal(decision.reason, "budget");
  assert.equal(decision.hold, null, "额度用完是硬停止，不回退成 hold");
});

test("hold：想说但这会儿不合适，记一次 20 分钟后回收", () => {
  const state = commit({}, { now: T0 });
  const decision = decide({ now: T0 + 30 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state });
  assert.equal(decision.act, false);
  assert.equal(decision.reason, "gap");
  assert.equal(decision.hold.expiresAt, T0 + 30 * MIN + PROACTIVE.holdMinutes * MIN);
  assert.equal(decision.hold.decay, 1);
  assert.ok(decision.substitute, "不说也要有替代动作");
});

test("hold 不累积：连续问不会把「不说」加固成习惯", () => {
  const state = commit({}, { now: T0 });
  const first = decide({ now: T0 + 30 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state });
  const holding = normalizeState({ ...state, hold: first.hold }, { now: T0 + 30 * MIN });
  const second = decide({ now: T0 + 35 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state: holding });
  assert.equal(second.reason, "holding");
  assert.equal(second.hold.expiresAt, first.hold.expiresAt, "回收时间没有被延长");
  assert.ok(second.hold.remainingMinutes <= 15);
});

test("hold 过期就失效：20 分钟后可以重新决定", () => {
  const state = commit({}, { now: T0 });
  const first = decide({ now: T0 + 30 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state });
  const holding = normalizeState({ ...state, hold: first.hold }, { now: T0 + 30 * MIN });
  const later = decide({ now: T0 + 65 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state: holding });
  assert.equal(later.act, true);
  assert.equal(later.reason, "ok");
});

test("睡着 / 深夜：不问意图，也不记 hold", () => {
  assert.equal(check({ asleep: true }).reason, "asleep");
  const night = decide({
    now: Date.parse("2026-10-24T02:00:00+08:00"),
    layers,
    lastInteractionAt: T0,
    state: {},
  });
  assert.equal(night.reason, "quiet");
  assert.equal(night.hold, null);
});

test("他刚说完：先接话，不另起话头", () => {
  // 连接感偏低时她才会有比较强的开口冲动——否则「没有冲动」先一步就返回了。
  const lonely = normalizeLayers({});
  lonely.social.connection = 40;
  const decision = decide({ now: T0 + 5 * MIN, layers: lonely, lastInteractionAt: T0 + 4 * MIN, state: {} });
  assert.equal(decision.reason, "just_spoke");
  assert.equal(decision.hold.reason, "just_spoke");
});

test("被拒要记账：扣预算、记冷却", () => {
  const state = reject({}, { now: T0 });
  assert.equal(state.today.count, 1);
  assert.equal(state.cooldownUntil, T0 + PROACTIVE.cooldownMinutes * MIN);

  const cooling = decide({ now: T0 + 5 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state });
  assert.equal(cooling.reason, "cooldown");
  const later = decide({ now: T0 + 65 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state: { ...state, hold: null } });
  assert.equal(later.act, true);
});

test("跨天清零：第二天额度重新算", () => {
  let state = {};
  for (let i = 0; i < 3; i += 1) state = commit(state, { now: T0 + i * 90 * MIN });
  const tomorrow = decide({
    now: Date.parse("2026-10-25T12:00:00+08:00"),
    layers,
    lastInteractionAt: T0,
    state,
  });
  assert.equal(tomorrow.budget.used, 0);
  assert.equal(tomorrow.act, true);
});

test("确定性：同样的状态、同样的时间，同样的决定", () => {
  const state = commit({}, { now: T0 });
  const once = decide({ now: T0 + 30 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state });
  const twice = decide({ now: T0 + 30 * MIN, layers, lastInteractionAt: T0 - 24 * HOUR, state });
  assert.deepEqual(once, twice);
});
