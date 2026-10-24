import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, name, inject, Config } from "../src/index.js";

function fakeContext() {
  const tools = new Map();
  const logs = [];
  return {
    tools,
    logs,
    ctx: {
      tools: {
        register(definition) {
          tools.set(definition.name, definition);
          return () => tools.delete(definition.name);
        },
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
  assert.deepEqual(inject, ["tools"]);
  assert.ok(Config);
  assert.equal(typeof apply, "function");
});

test("挂载后注册 10 个工具，名字都带前缀", (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t) });
  assert.equal(tools.size, 10);
  for (const toolName of [
    "serene_context",
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
