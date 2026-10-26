/**
 * web/lib/runtime.mjs — 网页版的「她」。
 *
 * 这里不复制 Project Serene 的任何业务，只把 dsh-serene 已有的东西接起来：
 *   人格（personas/）、三层情绪（core/emotion.js）、记忆与召回（core/recall.js）、
 *   此刻与外面（core/life.js、core/almanac.js）、看法与观察（beliefs/profile）、
 *   主动性（core/motivation.js）、表达自检（core/style.js）。
 *
 * 一次对话做五件事：读情绪 → 召回 → 拼 prompt → 调模型 → 写回情绪/记忆。
 * 记忆抽取是第二次很小的调用，失败不影响这一轮说话。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { almanacAt } from "../../core/almanac.js";
import { mergeBeliefs } from "../../core/beliefs.js";
import { detectCrisis } from "../../core/crisis.js";
import { describeDecision, PROACTIVE } from "../../core/motivation.js";
import { energyAt, lifeAt, timePhrase } from "../../core/life.js";
import { mentalAt, mentalLine } from "../../core/mental.js";
import { MEMORY_KINDS } from "../../core/recall.js";
import { profileSummary } from "../../core/profile.js";
import { checkStyle } from "../../core/style.js";
import { loadPersona } from "../../src/persona.js";
import { OpeningStore } from "../../src/opening.js";
import { BeliefStore } from "../../src/stores/belief-store.js";
import { CrystalStore } from "../../src/stores/crystal-store.js";
import { EmotionStore } from "../../src/stores/emotion-store.js";
import { LeisureStore } from "../../src/stores/leisure-store.js";
import { MemoryStore } from "../../src/stores/memory-store.js";
import { MotivationStore } from "../../src/stores/motivation-store.js";
import { ProfileStore } from "../../src/stores/profile-store.js";
import { personaDataDir, webDataDir } from "./config.mjs";
import { parseJsonLoose } from "./model.mjs";
import {
  buildActionSystem,
  buildChatSystem,
  buildExtractionMessages,
  buildOpeningSystem,
  buildProactiveSystem,
  splitBubbles,
  STAGE_DIRECTION,
} from "./prompt.mjs";

const MAX_USER_CHARS = 2000;
const HISTORY_FOR_MODEL = 16;
const CHAT_KEEP = 300;

/** 四个不涉及身体、不越界的动作。她回应的是「被碰了一下」这件事，不是设定。 */
export const ACTIONS = Object.freeze([
  {
    id: "poke",
    label: "戳一戳",
    noteText: "你戳了戳她",
    scene: "对方伸手戳了你一下。",
    note: "不用把它当成大事，但别装作没发生。",
    kind: "tease",
    intensity: 0.8,
  },
  {
    id: "pat",
    label: "摸摸头",
    noteText: "你摸了摸她的头",
    scene: "对方抬手，轻轻摸了摸你的头。",
    note: "你可以不习惯，也可以安静地接受；不要用甜腻的话谢对方。",
    kind: "affection",
    intensity: 1,
  },
  {
    id: "water",
    label: "递杯水",
    noteText: "你给她递了杯水",
    scene: "对方把一杯水放在你手边。",
    note: "你注意到了这个动作。说一句具体的，不要只说谢谢。",
    kind: "care",
    intensity: 1,
  },
  {
    id: "praise",
    label: "夸她一句",
    noteText: "你夸了她一句",
    scene: "对方看着你，认真夸了你一句。",
    note: "被夸到了。可以高兴，也可以有点不自在；不要反过来夸对方。",
    kind: "address",
    intensity: 1,
  },
]);

export class SereneWeb {
  #tail = Promise.resolve();
  #openingPromise = null;
  #lastTickAt = 0;
  #lastProactiveAt = 0;
  #lastDecision = null;
  #lastDecisionAt = 0;
  #traces = new Map();

  /**
   * @param {object} options
   * @param {string} options.personaName
   * @param {string} options.personaRoot
   * @param {string} options.baseDataDir
   * @param {object} options.config
   * @param {(options: object) => Promise<{text: string, usage?: object, model?: string, latencyMs?: number}>} options.complete
   * @param {boolean} [options.demo]
   */
  constructor({ personaName, personaRoot, baseDataDir, config, complete, demo = false }) {
    this.config = config;
    this.demo = Boolean(demo);
    this.requestedPersona = personaName;
    this.persona = loadPersona(personaName, { root: personaRoot });
    this.personaDir = personaDataDir(baseDataDir, this.persona, personaName);
    this.dataDir = webDataDir(this.personaDir);
    mkdirSync(this.dataDir, { recursive: true });

    this.emotion = new EmotionStore({ dir: this.personaDir, baseline: this.persona.baseline });
    this.memory = new MemoryStore({ dir: this.personaDir, capacity: 500 });
    this.leisure = new LeisureStore({ dir: this.personaDir });
    this.beliefs = new BeliefStore({ dir: this.personaDir });
    this.crystals = config.crystals === false ? null : new CrystalStore({ dir: this.personaDir, seeds: this.persona.crystals });
    this.profile = new ProfileStore({ dir: this.personaDir });
    this.motivation = new MotivationStore({
      dir: this.personaDir,
      policy: { ...PROACTIVE, perDay: config.proactivePerDay },
    });
    this.opening = this.persona.sections?.opening
      ? new OpeningStore({ dir: this.personaDir, personaId: this.persona.id })
      : null;

    this.llm = complete;
    this.messages = this.#loadChat();
    this.#loadTraces();
    this.startedAt = Date.now();
    this.turns = this.messages.filter((message) => message.role === "user").length;
  }

  get model() {
    return this.config.model;
  }

  /** 串行：同一个人不能一边说话一边被另一条请求改情绪。 */
  #run(task) {
    const next = this.#tail.then(task, task);
    this.#tail = next.catch(() => {});
    return next;
  }

  /* ───────────────────────── 对外的四个动作 ───────────────────────── */

  say(text) {
    return this.#run(() => this.#say(text));
  }

  action(id) {
    return this.#run(() => this.#act(id));
  }

  /** 页面轮询：到点且该开口才开口。返回 null 表示这次什么都不做。 */
  tick() {
    return this.#run(() => this.#tick());
  }

  /** 第一次打开页面：她说第一句。只发生一次。 */
  openFirst() {
    return this.#run(() => this.#open());
  }

  /* ───────────────────────── 说话 ───────────────────────── */

  async #say(rawText) {
    const text = String(rawText ?? "").trim().slice(0, MAX_USER_CHARS);
    if (!text) throw new HttpError(400, "说点什么再发。", "EMPTY");
    // 先认这一句要不要按危机接。它只改这一轮的 prompt 和长度，不改人格、不改记忆。
    const crisis = detectCrisis(text);
    const now = Date.now();
    const life = this.#life(now);
    const before = this.#emotionSnapshot(now, life);
    const classified = this.emotion.applyMessage(text, { lexicon: this.persona.lexicon, now });
    const after = this.#emotionSnapshot(now, life);
    const recall = this.#recall(text, after, now);
    const system = buildChatSystem({
      persona: this.persona,
      emotion: this.emotion,
      memory: this.memory,
      opening: this.opening,
      beliefs: this.beliefs.beliefs,
      profile: this.profile.observations,
      recall,
      now,
      depth: this.config.depth,
      asleep: life.asleep,
      crisis,
      userText: text,
      leisure: this.leisure.all(),
      crystals: this.crystals?.data ?? null,
    });

    const history = this.#historyForModel();
    const reply = await this.llm({
      messages: [{ role: "system", content: system.system }, ...history, { role: "user", content: text }],
      // 危机那一轮允许长一点：三到六句，不是平时的「一两句」。
      maxTokens: crisis.level === "high" ? 460 : 300,
      temperature: crisis.level === "high" ? 0.8 : 1.05,
      timeoutMs: 90_000,
    });
    const bubbles = splitBubbles(reply.text).slice(0, crisis.level === "high" ? 3 : 2);
    const joined = bubbles.join("\n");
    const style = checkStyle(
      joined,
      crisis.level === "high"
        ? { maxChars: 280, maxSentences: 6, maxQuestions: 1 }
        : { maxChars: 120, maxSentences: 3, maxQuestions: 1 },
    );

    this.emotion.afterReply({ text: joined, lastKind: classified?.kind ?? "", now });
    const userMessage = this.#append({ role: "user", text, at: now, kind: "say" });
    const replies = bubbles.map((bubble) =>
      this.#append({ role: "her", text: bubble, at: Date.now(), kind: "say", replyTo: userMessage.id }),
    );
    if (this.opening?.pending()) this.opening.markOpened(now);
    this.#invalidateDecision();

    // 危机这一轮不抽取记忆：把「他说过不想活」写成一条长期记忆，以后每次召回都可能
    // 把它带回对话里，既不安全也不体面。
    const extraction =
      crisis.level === "high"
        ? { skipped: "危机轮不写入记忆" }
        : await this.#remember({ userText: text, reply: joined, now });
    const trace = this.#trace({
      kind: "say",
      at: now,
      userText: text,
      bubbles,
      system,
      reply,
      style,
      classified,
      crisis,
      before,
      after,
      recall,
      extraction,
    });

    return { user: userMessage, replies, trace, state: this.state() };
  }

  async #act(id) {
    const action = ACTIONS.find((item) => item.id === String(id ?? ""));
    if (!action) throw new HttpError(400, "没有这个动作。", "NO_ACTION");
    const now = Date.now();
    const life = this.#life(now);
    const before = this.#emotionSnapshot(now, life);
    this.emotion.record(action.kind, { now, intensity: action.intensity, note: action.label });
    const after = this.#emotionSnapshot(now, life);
    const recall = this.#recall(action.scene, after, now);
    const system = buildActionSystem(
      {
        persona: this.persona,
        emotion: this.emotion,
        memory: this.memory,
        opening: this.opening,
        beliefs: this.beliefs.beliefs,
        profile: this.profile.observations,
        recall,
        now,
        depth: this.config.depth,
        asleep: life.asleep,
      },
      action,
    );

    const reply = await this.llm({
      messages: [
        { role: "system", content: system.system },
        ...this.#historyForModel(),
        { role: "user", content: `（${action.scene}）` },
      ],
      maxTokens: 220,
      temperature: 1.05,
      timeoutMs: 90_000,
    });
    const bubbles = splitBubbles(reply.text).slice(0, 2);
    const joined = bubbles.join("\n");
    const style = checkStyle(joined, { maxChars: 100, maxSentences: 3, maxQuestions: 1 });

    const note = this.#append({ role: "note", text: action.noteText, at: now, kind: `action:${action.id}` });
    const replies = bubbles.map((bubble) => this.#append({ role: "her", text: bubble, at: Date.now(), kind: "action" }));
    this.#invalidateDecision();
    const trace = this.#trace({
      kind: `action:${action.id}`,
      at: now,
      userText: action.scene,
      bubbles,
      system,
      reply,
      style,
      classified: { kind: action.kind, label: action.label },
      before,
      after,
      recall,
      extraction: null,
      note: note.text,
    });
    return { note, replies, trace, state: this.state() };
  }

  async #open() {
    if (!this.opening?.pending()) return null;
    if (this.#openingPromise) return this.#openingPromise;
    this.#openingPromise = (async () => {
      const now = Date.now();
      const life = this.#life(now);
      const system = buildOpeningSystem({
        persona: this.persona,
        emotion: this.emotion,
        memory: this.memory,
        opening: this.opening,
        beliefs: this.beliefs.beliefs,
        profile: this.profile.observations,
        recall: [],
        now,
        depth: "normal",
        asleep: life.asleep,
      });
      const reply = await this.llm({
        messages: [
          { role: "system", content: system.system },
          { role: "user", content: STAGE_DIRECTION.opening },
        ],
        maxTokens: 240,
        temperature: 1.1,
        timeoutMs: 90_000,
      });
      const bubbles = splitBubbles(reply.text).slice(0, 2);
      this.opening.markOpened(now);
      const replies = bubbles.map((bubble) => this.#append({ role: "her", text: bubble, at: Date.now(), kind: "opening" }));
      const trace = this.#trace({
        kind: "opening",
        at: now,
        bubbles,
        system,
        reply,
        style: checkStyle(bubbles.join("\n"), { maxChars: 100, maxSentences: 3 }),
        before: this.#emotionSnapshot(now, life),
        after: this.#emotionSnapshot(now, life),
        recall: [],
        extraction: null,
      });
      return { replies, trace, state: this.state() };
    })();
    try {
      return await this.#openingPromise;
    } finally {
      this.#openingPromise = null;
    }
  }

  async #tick() {
    const now = Date.now();
    if (now - this.#lastTickAt < 45_000) return null;
    this.#lastTickAt = now;
    const life = this.#life(now);
    const snapshot = this.#emotionSnapshot(now, life);

    if (this.config.proactivePerDay <= 0) {
      return { act: false, decision: { act: false, why: "主动开口是关着的", budget: { remaining: 0 } } };
    }
    if (now - this.#lastProactiveAt < 90_000) return null;

    const decision = this.motivation.decide({
      now,
      layers: snapshot.layers,
      lastInteractionAt: snapshot.lastInteractionAt,
      asleep: life.asleep,
    });
    this.#lastDecision = decision;
    this.#lastDecisionAt = now;
    if (!decision.act) return { act: false, decision: { ...decision, line: describeDecision(decision) } };

    const system = buildProactiveSystem({
      persona: this.persona,
      emotion: this.emotion,
      memory: this.memory,
      opening: this.opening,
      beliefs: this.beliefs.beliefs,
      profile: this.profile.observations,
      recall: [],
      now,
      depth: "normal",
      asleep: life.asleep,
    });
    const reply = await this.llm({
      messages: [{ role: "system", content: system.system }, { role: "user", content: STAGE_DIRECTION.proactive }],
      maxTokens: 220,
      temperature: 1.1,
      timeoutMs: 90_000,
    });
    const bubbles = splitBubbles(reply.text).slice(0, 2);
    const replies = bubbles.map((bubble) => this.#append({ role: "her", text: bubble, at: Date.now(), kind: "proactive" }));
    this.motivation.commit({ now });
    this.emotion.record("reply", { now, intensity: 0.6, note: "自己开口了" });
    this.#lastProactiveAt = now;
    this.#invalidateDecision();
    const trace = this.#trace({
      kind: "proactive",
      at: now,
      bubbles,
      system,
      reply,
      style: checkStyle(bubbles.join("\n"), { maxChars: 100, maxSentences: 3 }),
      before: snapshot,
      after: this.#emotionSnapshot(now, life),
      recall: [],
      extraction: null,
      decision,
    });
    return { act: true, replies, trace, decision: { ...decision, line: describeDecision(decision) }, state: this.state() };
  }

  /* ───────────────────────── 状态快照 ───────────────────────── */

  state({ includeChat = true } = {}) {
    const now = Date.now();
    const life = this.#life(now);
    const almanac = almanacAt(now, { hemisphere: this.persona.hemisphere });
    const emotion = this.#emotionSnapshot(now, life);
    const memoryStats = this.memory.stats({ now });
    const motivation = this.motivation.snapshot({ now });
    const decision = this.#cachedDecision(now, emotion, life);
    const learnedTopics = new Set(this.beliefs.beliefs.map((item) => item.topic));
    const beliefs = mergeBeliefs(this.persona.beliefs, this.beliefs.beliefs).map((item) => ({
      ...item,
      learned: learnedTopics.has(item.topic),
    }));

    return {
      ok: true,
      version: 1,
      now,
      clock: {
        time: new Date(now).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
        phrase: timePhrase(life),
      },
      persona: {
        id: this.persona.id,
        name: this.persona.name,
        role: this.persona.role,
        summary: this.persona.summary,
        traits: this.persona.traits,
        sections: Object.keys(this.persona.sections ?? {}),
      },
      life: {
        weekday: life.weekday,
        phase: life.phase,
        place: life.place,
        activity: life.activity,
        asleep: life.asleep,
        energy: energyAt(life),
        minute: life.minute,
      },
      almanac: {
        dateText: almanac.dateText,
        season: almanac.season,
        monthText: almanac.monthText,
      },
      emotion: {
        label: emotion.label,
        backgroundLabel: emotion.backgroundLabel,
        primaryLabel: emotion.primaryLabel,
        socialLabel: emotion.socialLabel,
        tone: emotion.tone,
        mood: emotion.mood,
        divergent: emotion.divergent,
        contrast: emotion.contrast,
        advice: emotion.advice,
        dimensions: emotion.dimensions,
        layerDimensions: emotion.layerDimensions,
        wounds: emotion.wounds,
        residue: emotion.residue,
        causes: this.emotion.causes(now, 5),
        lastInteractionAt: emotion.lastInteractionAt,
        mental: mentalLine(mentalAt(life, emotion.layers)),
      },
      memory: {
        count: memoryStats.size,
        capacity: memoryStats.capacity,
        kinds: memoryStats.kinds,
        averageRetention: memoryStats.averageRetention,
        recent: this.memory
          .all()
          .slice()
          .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
          .slice(0, 8)
          .map((item) => ({
            id: item.id,
            text: item.text,
            kind: item.kind,
            importance: item.importance,
            createdAt: item.createdAt,
          })),
        forgotten: this.memory.forgotten({ limit: 4 }).map((item) => ({ id: item.id, at: item.at, reason: item.reason })),
      },
      beliefs,
      profile: {
        observations: this.profile.observations.slice().sort((a, b) => b.confidence - a.confidence).slice(0, 8),
        summary: profileSummary(this.profile.observations),
      },
      proactive: {
        remaining: motivation.remaining,
        policy: motivation.policy,
        today: motivation.today,
        lastProactiveAt: motivation.lastProactiveAt,
        hold: motivation.hold,
        decision: {
          act: Boolean(decision?.act),
          reason: decision?.reason ?? "ok",
          why: decision?.why ?? "",
          line: decision?.line ?? describeDecision(decision ?? { act: false, why: "" }),
          substitute: decision?.substitute ?? null,
        },
      },
      opening: {
        pending: Boolean(this.opening?.pending()),
        openedAt: this.opening?.snapshot().openedAt ?? 0,
      },
      turns: this.turns,
      startedAt: this.startedAt,
      lastTraceId: this.latestTrace()?.id ?? null,
      chat: includeChat ? { messages: this.messages.slice(-80) } : { messages: [] },
      demo: this.demo,
    };
  }

  getTrace(id) {
    if (!id || id === "latest") return this.latestTrace();
    return this.#traces.get(String(id)) ?? null;
  }

  latestTrace() {
    const ids = [...this.#traces.keys()];
    return ids.length ? this.#traces.get(ids[ids.length - 1]) : null;
  }

  /** 记忆全部条目：给「她记得」那扇窗用。 */
  memories({ now = Date.now() } = {}) {
    return {
      stats: this.memory.stats({ now }),
      items: this.memory
        .all()
        .slice()
        .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
        .map((item) => ({
          id: item.id,
          text: item.text,
          kind: item.kind,
          importance: item.importance,
          createdAt: item.createdAt,
          stability: item.stability,
          recallCount: item.recallCount,
          evidence: Array.isArray(item.evidence) ? item.evidence : [],
        })),
      forgotten: this.memory.forgotten({ limit: 8 }).map((item) => ({ id: item.id, at: item.at, reason: item.reason })),
    };
  }

  /* ───────────────────────── 记忆 ───────────────────────── */

  async #remember({ userText, reply, now }) {
    if (!this.config.remember) return { skipped: "关掉了记忆抽取" };
    if (String(userText).trim().length < 4) return { skipped: "太短" };
    let parsed = null;
    try {
      const result = await this.llm({
        messages: buildExtractionMessages({ userText, reply, now }),
        json: true,
        maxTokens: 480,
        temperature: 0.2,
        timeoutMs: 45_000,
      });
      parsed = parseJsonLoose(result.text);
    } catch (error) {
      return { error: error?.message ?? "抽取失败" };
    }
    if (!parsed) return { error: "没有返回可用的 JSON" };

    const wrote = { memories: [], profile: [], beliefs: [] };
    const existing = new Set(this.memory.all().map((item) => item.text));
    for (const item of asArray(parsed.memories).slice(0, 2)) {
      const text = String(item?.text ?? "").trim().slice(0, 60);
      if (text.length < 2 || existing.has(text)) continue;
      const kind = MEMORY_KINDS.includes(item?.kind) ? item.kind : "fact";
      const importance = clamp(Number(item?.importance), 0.1, 1, 0.5);
      const memory = this.memory.add(
        { text, kind, evidence: item?.evidence, importance, source: "web", createdAt: now },
        { now },
      );
      if (memory) {
        existing.add(text);
        wrote.memories.push({ id: memory.id, text, kind });
      }
    }
    for (const item of asArray(parsed.profile).slice(0, 1)) {
      const dimension = String(item?.dimension ?? "").trim();
      const value = String(item?.value ?? "").trim().slice(0, 40);
      if (!dimension || !value) continue;
      const result = this.profile.observe({ dimension, value, weight: 1, now });
      if (result.changed) wrote.profile.push({ dimension, value });
    }
    for (const item of asArray(parsed.beliefs).slice(0, 1)) {
      const topic = String(item?.topic ?? "").trim().slice(0, 30);
      const stance = Number(item?.stance);
      if (!topic || !Number.isFinite(stance)) continue;
      const weight = clamp(Number(item?.weight), 0.1, 1, 0.5);
      const result = this.beliefs.record({ topic, stance, weight, now });
      if (result.changed) wrote.beliefs.push({ topic, stance });
    }
    return { wrote };
  }

  /* ───────────────────────── 内部 ───────────────────────── */

  #life(now) {
    return lifeAt(now, { seed: this.persona.id, routine: this.persona.routine });
  }

  #emotionSnapshot(now, life) {
    return this.emotion.snapshot({ now, asleep: life?.asleep ?? false });
  }

  #recall(text, snapshot, now) {
    try {
      return this.memory.recall(text, { limit: 5, now, mood: snapshot?.mood ?? 0 });
    } catch {
      return [];
    }
  }

  #cachedDecision(now, emotion, life) {
    if (this.#lastDecision && now - this.#lastDecisionAt < 15_000) return this.#lastDecision;
    try {
      const decision = this.motivation.decide({
        now,
        layers: emotion.layers,
        lastInteractionAt: emotion.lastInteractionAt,
        asleep: life.asleep,
      });
      this.#lastDecision = { ...decision, line: describeDecision(decision) };
      this.#lastDecisionAt = now;
      return this.#lastDecision;
    } catch {
      return null;
    }
  }

  #invalidateDecision() {
    this.#lastDecision = null;
    this.#lastDecisionAt = 0;
  }

  #historyForModel() {
    return this.messages
      .filter((message) => message.role === "user" || message.role === "her")
      .slice(-HISTORY_FOR_MODEL)
      .map((message) => ({ role: message.role === "her" ? "assistant" : "user", content: message.text }));
  }

  #append(message) {
    const entry = {
      id: `${message.role.slice(0, 1)}_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
      role: message.role,
      text: String(message.text ?? "").slice(0, 4000),
      at: Number(message.at) || Date.now(),
      kind: message.kind ?? "say",
    };
    if (message.replyTo) entry.replyTo = message.replyTo;
    this.messages.push(entry);
    if (this.messages.length > CHAT_KEEP) this.messages.splice(0, this.messages.length - CHAT_KEEP);
    if (entry.role === "user") this.turns += 1;
    try {
      appendFileSync(join(this.dataDir, "chat.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // 落不下盘也不能拦住这句话。
    }
    return entry;
  }

  #loadChat() {
    const file = join(this.dataDir, "chat.jsonl");
    if (!existsSync(file)) return [];
    const messages = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const text = line.trim();
      if (!text) continue;
      try {
        const row = JSON.parse(text);
        if (!row?.id || !["user", "her", "note"].includes(row.role) || !row.text) continue;
        messages.push({
          id: String(row.id),
          role: row.role,
          text: String(row.text),
          at: Number(row.at) || 0,
          kind: String(row.kind ?? "say"),
          ...(row.replyTo ? { replyTo: String(row.replyTo) } : {}),
        });
      } catch {
        // 半截行跳过。
      }
    }
    return messages.slice(-CHAT_KEEP);
  }

  #trace({ kind, at, userText = "", bubbles, system, reply, style, classified = null, crisis = null, before, after, recall, extraction, decision = null, note = "" }) {
    const trace = {
      id: `t_${at.toString(36)}_${randomUUID().slice(0, 6)}`,
      kind,
      at,
      userText,
      bubbles,
      note,
      prompt: { chars: system.system.length, sections: system.sections },
      reply: {
        text: bubbles.join("\n"),
        chars: bubbles.join("\n").length,
        latencyMs: reply.latencyMs ?? 0,
        model: reply.model ?? this.model,
        usage: reply.usage ?? null,
      },
      emotion: {
        before: pickEmotion(before),
        after: pickEmotion(after),
        delta: deltaEmotion(before, after),
      },
      classified,
      crisis,
      recall: (recall ?? []).map((item) => ({
        id: item.id,
        text: item.text,
        score: item.score,
        cue: item.cue,
        retention: item.retention,
        anchored: item.anchored === true,
        evidence: Array.isArray(item.evidence) ? item.evidence : [],
      })),
      wrote: extraction?.wrote ?? null,
      extractionError: extraction?.error ?? null,
      extractionSkipped: extraction?.skipped ?? null,
      style,
      decision: decision
        ? { act: decision.act, reason: decision.reason, why: decision.why, substitute: decision.substitute ?? null }
        : null,
    };
    this.#traces.set(trace.id, trace);
    if (this.#traces.size > 60) this.#traces.delete(this.#traces.keys().next().value);
    try {
      appendFileSync(join(this.dataDir, "traces.jsonl"), `${JSON.stringify(trace)}\n`, "utf8");
    } catch {
      // 透视是附加功能，写不进去不影响聊天。
    }
    return trace;
  }

  #loadTraces() {
    const file = join(this.dataDir, "traces.jsonl");
    if (!existsSync(file)) return;
    try {
      const lines = readFileSync(file, "utf8").trim().split("\n").slice(-60);
      for (const line of lines) {
        const row = JSON.parse(line);
        if (row?.id) this.#traces.set(row.id, row);
      }
    } catch {
      // 损坏就当作没有历史透视。
    }
  }

  /**
   * 清空某一类东西：不删除，只改名归档。返回归档了哪些文件。
   * 调用方负责重新构造 runtime。
   */
  archive(scope = "chat", now = Date.now()) {
    const dir = join(this.dataDir, "archive");
    mkdirSync(dir, { recursive: true });
    const groups = {
      chat: ["chat.jsonl", "traces.jsonl"],
      memory: ["memories.jsonl", "emotion.json", "scars.json", "beliefs.json", "profile.json", "opening.json", "motivation.json"],
      all: [
        "chat.jsonl",
        "traces.jsonl",
        "memories.jsonl",
        "emotion.json",
        "scars.json",
        "beliefs.json",
        "profile.json",
        "opening.json",
        "motivation.json",
      ],
    };
    const files = groups[scope] ?? groups.chat;
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    const moved = [];
    for (const file of files) {
      const from = join(this.dataDir, file);
      if (!existsSync(from)) continue;
      const to = join(dir, `${stamp}-${file}`);
      try {
        renameSync(from, to);
        moved.push(to);
      } catch {
        // 被占用就跳过，别把整个重置弄挂。
      }
    }
    return moved;
  }
}

export class HttpError extends Error {
  constructor(status, message, code = "BAD_REQUEST") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function pickEmotion(snapshot) {
  if (!snapshot) return null;
  return {
    label: snapshot.label,
    background: snapshot.backgroundLabel,
    primary: snapshot.primaryLabel,
    social: snapshot.socialLabel,
    mood: snapshot.mood,
    dimensions: snapshot.dimensions?.map((item) => ({ key: item.key, label: item.label, value: item.value })) ?? [],
  };
}

function deltaEmotion(before, after) {
  if (!before?.dimensions || !after?.dimensions) return {};
  const map = new Map(after.dimensions.map((item) => [item.key, item.value]));
  const delta = {};
  for (const item of before.dimensions) {
    const next = map.get(item.key);
    if (Number.isFinite(next)) delta[item.key] = Math.round((next - item.value) * 10) / 10;
  }
  return delta;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export { buildExtractionMessages };
