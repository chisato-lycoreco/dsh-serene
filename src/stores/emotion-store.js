/**
 * EmotionStore — 情感状态层唯一的 I/O 边界。
 *
 * core/emotion.js 是纯函数：算衰减、算事件、算描述，不碰磁盘也不看时钟。
 * 这个类负责另外三件事：
 *   1. 读写状态文件（原子写：临时文件 + rename）；
 *   2. 用真实时间把「上次到现在」这段补上（离线也会衰减）；
 *   3. 把「消息 → 事件 → 状态变化」串起来。
 *
 * 状态文件是一份普通 JSON，可以随时打开看、可以手改、可以进 git（如果你想）。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASELINE,
  EVENT_EFFECTS,
  advance,
  applyEventToLayers,
  classifyExpression,
  classifyMessage,
  cloneLayers,
  deriveBaseline,
  describeLayers,
  emotionBlock,
  moodOf,
  normalizeLayers,
  proactiveGap,
  woundDepth,
} from "../../core/emotion.js";

const VERSION = 1;
const HISTORY_LIMIT = 40;
/** 这些事件会更新「最后一次互动」，用来算冷落造成的连接感流失。 */
const INTERACTION_KINDS = new Set(["chat", "affection", "address", "intimacy", "kiss", "tease", "care", "humor", "share", "question", "goodnight", "repair", "coax", "conflict", "scold", "rejection"]);
/** 会考虑留疤的事件。 */
const WOUNDING_KINDS = new Set(["conflict", "scold", "rejection", "ignored"]);
const NEGATIVE_KINDS = new Set(["conflict", "scold", "rejection", "ignored", "neglect", "jealousy", "cold_read"]);

const isFiniteNumber = (value) => Number.isFinite(Number(value));

export class EmotionStore {
  #dir;
  #file;
  #woundsFile;
  #baseline = BASELINE;
  #state = null;

  constructor({ dir, file = "emotion.json", woundsFile = "scars.json", baseline = BASELINE } = {}) {
    if (!dir) throw new Error("EmotionStore 需要一个数据目录");
    this.#dir = dir;
    this.#file = file;
    this.#woundsFile = woundsFile;
    this.#baseline = baseline;
  }

  get dir() {
    return this.#dir;
  }

  /** 当前生效的基线（出厂基线 + 所有疤）。 */
  get baseline() {
    return this.#baseline;
  }

  /** 幂等加载：读盘、算疤、把离线这段时间补上。 */
  load(now = Date.now()) {
    if (this.#state) return this;
    let raw = null;
    try {
      raw = JSON.parse(readFileSync(join(this.#dir, this.#file), "utf8"));
    } catch {
      raw = null;
    }
    const wounds = Array.isArray(raw?.wounds) ? raw.wounds : this.#readWounds();
    this.#baseline = deriveBaseline(BASELINE, wounds);
    this.#state = {
      version: VERSION,
      updatedAt: isFiniteNumber(raw?.updatedAt) ? Number(raw.updatedAt) : now,
      lastInteractionAt: isFiniteNumber(raw?.lastInteractionAt) ? Number(raw.lastInteractionAt) : 0,
      layers: normalizeLayers(raw?.layers ?? {}),
      wounds,
      history: Array.isArray(raw?.history) ? raw.history.slice(-HISTORY_LIMIT) : [],
    };
    this.tick({ now, save: false });
    return this;
  }

  /** 让状态走到 now。返回是否有实际变化。 */
  tick({ now = Date.now(), asleep = false, save = true } = {}) {
    this.load(now);
    const state = this.#state;
    const from = state.updatedAt;
    if (now <= from) return false;
    state.layers = advance(state.layers, {
      from,
      to: now,
      asleep,
      lastInteractionAt: state.lastInteractionAt,
      baseline: this.#baseline,
    });
    state.updatedAt = now;
    if (save) this.save();
    return true;
  }

  /**
   * 记一件确定性事件。
   *
   * @param {string} kind EVENT_EFFECTS 里的 key
   * @param {{now?: number, intensity?: number, note?: string, context?: string, save?: boolean}} [options]
   */
  record(kind, { now = Date.now(), intensity = 1, note = "", context = "", save = true } = {}) {
    this.load(now);
    if (!EVENT_EFFECTS[kind]) throw new Error(`未知事件：${kind}`);
    this.tick({ now, save: false });

    const state = this.#state;
    const strength = this.#sensitivity(kind, now) * Math.max(0.1, Math.min(2, Number(intensity) || 1));
    const before = cloneLayers(state.layers);
    state.layers = applyEventToLayers(state.layers, kind, { intensity: strength, baseline: this.#baseline });
    if (INTERACTION_KINDS.has(kind)) state.lastInteractionAt = now;

    const wound = this.#maybeWound(kind, { now, strength, note, context });
    state.history.push({ kind, at: now, intensity: Math.round(strength * 100) / 100 });
    if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
    state.updatedAt = now;
    if (save) this.save();

    return {
      kind,
      note: note || undefined,
      wound,
      changed: this.#diff(before, state.layers),
      layers: cloneLayers(state.layers),
    };
  }

  /** 一条用户消息 → 一个事件。分类是确定性的，不调模型。 */
  applyMessage(message, { now = Date.now(), lexicon = null, save = true } = {}) {
    this.load(now);
    this.tick({ now, save: false });
    const classified = classifyMessage(message, { layers: this.#state.layers, lexicon });
    if (!classified) return null;
    const result = this.record(classified.kind, {
      now,
      intensity: classified.intensity,
      note: classified.note,
      context: String(message?.text ?? ""),
      save,
    });
    return { ...classified, ...result };
  }

  /** 她自己刚说出口的话 → 说出口 / 咽回去。 */
  afterReply({ now = Date.now(), text = "", lastKind = "", save = true } = {}) {
    this.load(now);
    const classified = classifyExpression(text, { lastKind });
    if (!classified) return null;
    return this.record(classified.kind, { now, intensity: classified.intensity, note: classified.note, save });
  }

  /** 给 prompt / 工具 / 界面看的一份快照。不含数值以外的私有东西。 */
  snapshot({ now = Date.now(), asleep = false, reading = null } = {}) {
    this.load(now);
    this.tick({ now, asleep, save: true });
    const described = describeLayers(this.#state.layers);
    const wounds = this.#state.wounds.slice(-6);
    const snapshot = {
      ...described,
      wounds,
      reading,
      mood: moodOf(this.#state.layers),
      proactiveGapMs: proactiveGap(this.#state.layers),
      updatedAt: this.#state.updatedAt,
      lastInteractionAt: this.#state.lastInteractionAt,
    };
    snapshot.text = emotionBlock(snapshot);
    return snapshot;
  }

  /** 最近发生的事，按新到旧。 */
  causes(now = Date.now(), limit = 6) {
    this.load(now);
    return this.#state.history
      .slice(-limit)
      .reverse()
      .map((item) => ({ ...item, ageMinutes: Math.max(0, Math.round((now - item.at) / 60000)) }));
  }

  /** 回到出厂状态（疤一起清掉）。 */
  reset({ now = Date.now(), save = true } = {}) {
    this.load(now);
    this.#state = {
      version: VERSION,
      updatedAt: now,
      lastInteractionAt: 0,
      layers: normalizeLayers({}),
      wounds: [],
      history: [],
    };
    this.#baseline = BASELINE;
    if (save) this.save();
  }

  /** 原子写：先写临时文件再 rename。进程被杀也不会留半截 JSON。 */
  save() {
    if (!this.#state) return;
    mkdirSync(this.#dir, { recursive: true });
    const target = join(this.#dir, this.#file);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.#state, null, 2)}\n`, "utf8");
    renameSync(temp, target);
  }

  /** 卸载时调用；没加载过就不写盘。 */
  flush() {
    if (this.#state) this.save();
  }

  #readWounds() {
    try {
      const raw = JSON.parse(readFileSync(join(this.#dir, this.#woundsFile), "utf8"));
      return Array.isArray(raw) ? raw : Array.isArray(raw?.wounds) ? raw.wounds : [];
    } catch {
      return [];
    }
  }

  /** 连着踩同一处会疼得更狠：同一种负面事件在 30 分钟内重复，力度累加。 */
  #sensitivity(kind, now) {
    if (!NEGATIVE_KINDS.has(kind)) return 1;
    const recent = this.#state.history.filter((item) => item.kind === kind && now - item.at < 30 * 60_000);
    return Math.min(1.6, 1 + recent.length * 0.15);
  }

  #maybeWound(kind, { now, strength, note, context }) {
    if (!WOUNDING_KINDS.has(kind)) return null;
    const pleasureDelta = (EVENT_EFFECTS[kind]?.primary?.pleasure ?? 0) * strength;
    const depth = woundDepth(pleasureDelta, context);
    if (!depth) return null;
    const wound = {
      at: now,
      kind,
      depth,
      note: note || kind,
      context: String(context ?? "").slice(0, 60),
    };
    this.#state.wounds.push(wound);
    this.#baseline = deriveBaseline(BASELINE, this.#state.wounds);
    return wound;
  }

  /** 变化最大的几维，给工具输出用。 */
  #diff(before, after) {
    const changed = [];
    for (const name of ["background", "primary", "social"]) {
      for (const key of Object.keys(after[name])) {
        const delta = Math.round((after[name][key] - before[name][key]) * 10) / 10;
        if (Math.abs(delta) >= 0.3) changed.push({ layer: name, key, delta });
      }
    }
    return changed.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
  }
}
