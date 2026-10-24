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

test("挂载后注册 6 个工具，名字都带前缀", (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t) });
  assert.equal(tools.size, 6);
  for (const toolName of tools.keys()) assert.match(toolName, /^serene_/);
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

test("人格读不到时安静降级，不拖垮宿主", (t) => {
  const { ctx, tools, logs } = fakeContext();
  apply(ctx, { dataDir: tempDir(t), persona: "missing" });
  assert.equal(tools.size, 0);
  assert.equal(logs[0][0], "error");
});

test("enabled=false 时什么都不注册", (t) => {
  const { ctx, tools } = fakeContext();
  apply(ctx, { dataDir: tempDir(t), enabled: false });
  assert.equal(tools.size, 0);
});
