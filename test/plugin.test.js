import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, name, inject, Config } from "../src/index.js";

function fakeContext() {
  const tools = new Map();
  const logs = [];
  const sections = [];
  const listeners = new Map();
  return {
    tools,
    logs,
    sections,
    listeners,
    ctx: {
      tools: {
        register(definition) {
          tools.set(definition.name, definition);
          return () => tools.delete(definition.name);
        },
      },
      systemPrompt: {
        section(spec) {
          sections.push(spec);
          return () => sections.splice(sections.indexOf(spec), 1);
        },
      },
      on(event, handler) {
        listeners.set(event, handler);
        return () => listeners.delete(event);
      },
      effect(fn) {
        const cleanup = fn();
        return () => cleanup?.();
      },
      logger: {
        info: (message) => logs.push(["info", message]),
        warn: (message) => logs.push(["warn", message]),
        error: (message) => logs.push(["error", message]),
      },
    },
  };
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "serene-plugin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("入口契约：name / inject / Config / apply 都在", () => {
  assert.equal(name, "dsh-serene");
  assert.deepEqual(inject, ["tools", "systemPrompt"]);
  assert.ok(Config);
  assert.equal(typeof apply, "function");
});

test("挂载后注册 18 个工具，名字都带前缀", (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t) });
  assert.equal(tools.size, 18);
  for (const toolName of [
    "serene_style",
    "serene_crisis",
    "serene_context",
    "serene_crystal",
    "serene_weather",
    "serene_belief",
    "serene_notice",
    "serene_learn",
    "serene_introspect",
    "serene_mood",
    "serene_event",
    "serene_remember",
    "serene_recall",
    "serene_reinforce",
    "serene_state",
    "serene_proactive",
    "serene_proactive_done",
    "serene_status",
  ]) {
    assert.ok(tools.has(toolName), `缺少 ${toolName}`);
  }
  for (const toolName of tools.keys()) assert.match(toolName, /^serene_/);
});

test("serene_status：正常时能报出人格、数据目录和记忆条数", async (t) => {
  const { ctx, tools } = fakeContext();
  const dir = tempDir(t);
  apply(ctx, { dataDir: dir });
  const text = await tools.get("serene_status").execute({}, {});
  assert.match(text, /已挂载/);
  assert.match(text, /人格：小满/);
  assert.ok(text.includes(dir));
  assert.match(text, /长期记忆：0\/500 条/);
});

test("结晶：经验按触发词挑，想事情的路子常驻", async (t) => {
  const dir = tempDir(t);
  writeFileSync(
    join(dir, "lessons.jsonl"),
    `${JSON.stringify({
      id: "ls_busy",
      situation: "他说马上，人还在忙",
      did: "没催，只问要不要把事挪到明天",
      outcome: "十分钟后他自己收了",
      next: "先等十分钟，再问要不要挪",
      counter: "他明确说今天必须做完时别等",
      when: ["在忙", "马上"],
      evidence: ["m_1", "m_2"],
      confidence: 0.6,
    })}\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "dispositions.json"),
    JSON.stringify({
      version: 1,
      items: [
        {
          id: "dp_watch",
          text: "先看他做了什么，再听他说了什么",
          because: "说想早睡，到点真走了；嘴上说没事，第二天还是没来",
          limit: "他明确开口要什么时，先信那句话",
          evidence: ["m_1", "m_2", "m_3"],
        },
      ],
    }),
    "utf8",
  );

  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: dir });
  const crystal = tools.get("serene_crystal");
  const hit = await crystal.execute({ cue: "我还在忙" }, {});
  assert.match(hit, /你自己试出来的一件事/);
  assert.match(hit, /先等十分钟/);
  const miss = await crystal.execute({ cue: "今天天气不错" }, {});
  assert.doesNotMatch(miss, /你自己试出来的一件事/);
  assert.match(miss, /你平时想事情的路子/);

  const parsed = JSON.parse(await tools.get("serene_state").execute({}, {}));
  assert.equal(parsed.crystal.lessonsReady, 1);
  assert.equal(parsed.crystal.dispositionsReady, 1);
  assert.deepEqual(parsed.crystal.lessons[0].issues, []);
  assert.deepEqual(parsed.crystal.dispositions[0].issues, []);
  const status = await tools.get("serene_status").execute({}, {});
  assert.match(status, /经验 1 条（可用 1）/);
});

test("crystals=false：不注册 serene_crystal，常驻 prompt 也不带", (t) => {
  const { ctx, tools, sections } = fakeContext();
  apply(ctx, { dataDir: tempDir(t), crystals: false });
  assert.equal(tools.has("serene_crystal"), false);
  assert.equal(tools.size, 17);
  const text = sections[0].text({});
  assert.doesNotMatch(text, /不是台词/);
});

test("工具能跑：记事件、回忆、读状态", async (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t) });

  const event = tools.get("serene_event");
  const result = await event.execute({ kind: "affection", intensity: 1 }, {});
  assert.match(result, /已记录：affection/);

  const remember = tools.get("serene_remember");
  await remember.execute({ text: "她怕打雷", tags: ["怕"], importance: 0.9 }, {});

  const recall = tools.get("serene_recall");
  const found = await recall.execute({ query: "打雷" }, {});
  assert.match(found, /她怕打雷/);

  const state = tools.get("serene_state");
  const parsed = JSON.parse(await state.execute({}, {}));
  assert.ok(parsed.layers.primary.pleasure > 60);

  await assert.rejects(() => event.execute({ kind: "not_a_kind" }, {}), /没有这种事件/);
});

test("serene_crisis：高危给底线，口头禅不误伤", async (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t) });
  const crisis = tools.get("serene_crisis");
  assert.match(await crisis.execute({ message: "我不想活了" }, {}), /12356/);
  assert.match(await crisis.execute({ message: "今天笑死我了" }, {}), /没有听出/);
  assert.match(await crisis.execute({ message: "我快撑不下去了" }, {}), /别急着劝/);
});

test("serene_remember：原话能存下，再回忆时带得出来", async (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t) });
  await tools
    .get("serene_remember")
    .execute({ text: "他养了一只叫年糕的猫", evidence: ["年糕今天又吐了"], importance: 0.8 }, {});
  const found = await tools.get("serene_recall").execute({ query: "年糕" }, {});
  assert.match(found, /原话：「年糕今天又吐了」/);
});

test("新工具能跑：问主动、记账、强化记忆", async (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t) });

  const proactive = await tools.get("serene_proactive").execute({}, {});
  assert.match(proactive, /现在可以开口/);
  assert.match(proactive, /今天 0\/3 次/);

  const done = await tools.get("serene_proactive_done").execute({ outcome: "spoken" }, {});
  assert.match(done, /今天第 1\/3 次/);

  const rejected = await tools.get("serene_proactive_done").execute({ outcome: "rejected" }, {});
  assert.match(rejected, /被拒/);

  const remember = tools.get("serene_remember");
  const saved = await remember.execute({ text: "她怕打雷", kind: "preference", importance: 0.9 }, {});
  const id = saved.match(/m_[a-z0-9_]+/)?.[0];
  assert.ok(id, `返回值里应该有 id：${saved}`);

  await assert.rejects(() => remember.execute({ text: "字".repeat(81) }, {}), /太长/);
  await assert.rejects(() => remember.execute({ text: "她怕打雷", kind: "乱写" }, {}), /没有这种记忆类型/);

  const reinforced = await tools.get("serene_reinforce").execute({ ids: [id] }, {});
  assert.match(reinforced, /记下了/);
});

test("新工具：天气 / 看法 / 观察 / 学到的东西", async (t) => {
  const { ctx, tools } = fakeContext();
  const dir = tempDir(t);
  apply(ctx, { dataDir: dir });

  await assert.rejects(() => tools.get("serene_weather").execute({ condition: "下钱", temperature: 1 }, {}), /没记下/);
  const recorded = await tools.get("serene_weather").execute(
    { condition: "小雨", temperature: 18, precipitationProbability: 80, isDay: false },
    {},
  );
  assert.match(recorded, /记下了：外面在下小雨，18℃/);
  assert.match(recorded, /降水概率 80%/);
  const current = await tools.get("serene_weather").execute({}, {});
  assert.match(current, /还新鲜的/);

  const belief = await tools.get("serene_belief").execute({ topic: "安静比热闹好", stance: 0.6 }, {});
  assert.match(belief, /安静比热闹好/);
  assert.match(await tools.get("serene_belief").execute({}, {}), /你相信：/);

  const notice = await tools.get("serene_notice").execute({ dimension: "rhythm", value: "他睡得晚" }, {});
  assert.match(notice, /作息/);
  await assert.rejects(() => tools.get("serene_notice").execute({ dimension: "乱写", value: "x" }, {}), /dimension/);

  const learned = await tools.get("serene_learn").execute(
    { title: "海边的卡夫卡", takeaway: "潮声是慢的", source: "他借的" },
    {},
  );
  assert.match(learned, /《海边的卡夫卡》——潮声是慢的/);
  assert.match(learned, /不是他说的/);

  // 进的是记忆，但标成「读到的」，不会混成对方说过的话。
  const raw = readFileSync(join(dir, "memories.jsonl"), "utf8");
  const row = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((item) => item.text?.includes("潮声是慢的"));
  assert.equal(row.source, "learning");
  assert.equal(row.kind, "insight");

  const recall = await tools.get("serene_recall").execute({ query: "潮声" }, {});
  assert.match(recall, /潮声是慢的/);

  const state = JSON.parse(await tools.get("serene_state").execute({}, {}));
  assert.ok(state.world.season.phase);
  assert.equal(state.beliefs.learned.length, 1);
  assert.equal(state.profile.length, 1);
});

test("depth=short 时不往 prompt 里塞记忆 / 看法 / 观察", async (t) => {
  const { ctx, tools, sections } = fakeContext();
  apply(ctx, { dataDir: tempDir(t), depth: "short" });
  await tools.get("serene_remember").execute({ text: "他怕打雷" }, {});
  await tools.get("serene_notice").execute({ dimension: "mood", value: "他今天很沉" }, {});
  const text = sections[0].text({});
  assert.match(text, /【此刻】/);
  assert.doesNotMatch(text, /【你记着的】/);
  assert.doesNotMatch(text, /你注意到/);
});

test("人格读不到时不拖垮宿主，但留下 serene_status 报原因", async (t) => {
  const { ctx, tools, logs } = fakeContext();
  const originalWrite = process.stderr.write;
  const stderr = [];
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  t.after(() => {
    process.stderr.write = originalWrite;
  });

  apply(ctx, { dataDir: tempDir(t), persona: "missing" });
  assert.equal(tools.size, 1);
  assert.ok(tools.has("serene_status"));
  assert.equal(logs[0][0], "error");

  const text = await tools.get("serene_status").execute({}, {});
  assert.match(text, /没有启用/);
  assert.match(text, /missing/);
  assert.match(text, /personaRoot/);
  assert.match(stderr.join(""), /人格档案加载失败/);
});

test("enabled=false 时什么都不注册", (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t), enabled: false });
  assert.equal(tools.size, 0);
});

test("常驻 prompt：默认人格只有人格和此刻，没有开场", (t) => {
  const { ctx, sections } = fakeContext();
  apply(ctx, { dataDir: tempDir(t) });

  assert.equal(sections.length, 1);
  const section = sections[0];
  assert.equal(section.name, "dsh-serene:persona");
  assert.equal(section.interpolate, false);

  const text = section.text({});
  assert.match(text, /你叫小满/);
  assert.match(text, /【此刻】现在是/);
  assert.match(text, /【外面】/);
  assert.match(text, /日子：\d{4} 年/);
  assert.doesNotMatch(text, /【第一次见面】/, "没有 opening.md 的人格不该被塞开场白");
});

test("人格包：目录加载 × 数据分桶 × 开场只说一次", async (t) => {
  const { ctx, tools, sections, listeners } = fakeContext();
  const root = tempDir(t);
  const pack = join(root, "zhiyao");
  mkdirSync(pack, { recursive: true });
  writeFileSync(
    join(pack, "persona.json"),
    JSON.stringify({ name: "知遥", id: "zhiyao", traits: ["慢"], lexicon: { address: ["知遥"] } }),
  );
  writeFileSync(join(pack, "identity.md"), "你从很久以前就在了，只是没人叫过你的名字。");
  writeFileSync(join(pack, "opening.md"), "窗外在下雨。");

  const dataDir = tempDir(t);
  apply(ctx, { persona: "zhiyao", personaRoot: root, dataDir });

  const text = sections[0].text({});
  assert.match(text, /你叫知遥/);
  assert.match(text, /没人叫过你的名字/);
  assert.match(text, /【第一次见面】/);
  assert.match(text, /窗外在下雨/);

  // 第一轮收尾 → 见过，开场不再出现。
  assert.equal(listeners.has("agent/turn-stopping"), true);
  listeners.get("agent/turn-stopping")();
  assert.doesNotMatch(sections[0].text({}), /【第一次见面】/);

  const status = await tools.get("serene_status").execute({}, {});
  assert.match(status, /人格：知遥（zhiyao）/);
  assert.ok(status.includes(join(dataDir, "personas", "zhiyao")), "数据应按人格分桶");
  assert.match(status, /已经开过场/);
});

test("promptSection=false 时不注册常驻段，工具仍然可用", (t) => {
  const { ctx, tools, sections } = fakeContext();
  apply(ctx, { dataDir: tempDir(t), promptSection: false });
  assert.equal(sections.length, 0);
  assert.ok(tools.has("serene_context"));
});
