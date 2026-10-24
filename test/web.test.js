import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { splitBubbles } from "../web/lib/prompt.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, ".dev-data", `web-test-${process.pid}`);

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function request(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) }),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // 静态页不是 JSON。
          }
          done({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.once("error", fail);
    req.end(body);
  });
}

async function waitForServer(port, child) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 15_000) {
    if (child.exitCode !== null) throw new Error(`服务器提前退出：${child.exitCode}`);
    try {
      const res = await request(port, "/api/health");
      if (res.status === 200) return res.json;
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 80));
  }
  throw new Error(`服务器没有起来：${lastError?.message ?? "timeout"}`);
}

test("拆气泡：空行优先，超过上限就并进最后一条，不丢字", () => {
  assert.deepEqual(splitBubbles(""), []);
  assert.deepEqual(splitBubbles("嗯。"), ["嗯。"]);
  assert.deepEqual(splitBubbles("第一句。第二句。"), ["第一句。第二句。"]);
  assert.deepEqual(splitBubbles("一。\n二。\n三。\n四。"), ["一。\n二。\n三。\n四。"]);
  assert.deepEqual(splitBubbles("一。\n\n二。\n\n三。\n\n四。", { max: 3 }), ["一。", "二。", "三。\n\n四。"]);

  const longLines = `${"甲".repeat(40)}。\n${"乙".repeat(40)}。\n${"丙".repeat(40)}。\n${"丁".repeat(40)}。`;
  const bubbles = splitBubbles(longLines, { max: 3 });
  assert.equal(bubbles.length, 3);
  assert.equal(bubbles.join("").replace(/\s/g, ""), longLines.replace(/\s/g, ""));
});

test("网页版：演示模式完整走一轮，接口不泄露 key", async (t) => {
  await mkdir(DATA, { recursive: true });
  const port = await freePort();
  const server = spawn(
    process.execPath,
    ["web/server.mjs", "--demo", "--fresh", "--data", DATA, "--port", String(port), "--no-open", "--strict-port"],
    { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  let logs = "";
  server.stdout.on("data", (chunk) => {
    logs += chunk.toString("utf8").slice(-4000);
  });
  server.stderr.on("data", (chunk) => {
    logs += chunk.toString("utf8").slice(-4000);
  });

  t.after(async () => {
    if (server.exitCode === null) {
      server.kill();
      await Promise.race([once(server, "exit"), new Promise((done) => setTimeout(done, 2000))]);
    }
    await rm(DATA, { recursive: true, force: true }).catch(() => {});
  });

  const health = await waitForServer(port, server);
  assert.equal(health.ok, true);
  assert.equal(health.demo, true);

  const home = await request(port, "/");
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>知遥/);
  assert.match(home.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(home.headers["cache-control"], "no-store");

  const state0 = (await request(port, "/api/state")).json;
  assert.equal(state0.ok, true);
  assert.equal(state0.config.demo, true);
  assert.equal("apiKey" in state0.config, false);
  assert.doesNotMatch(JSON.stringify(state0), /sk-[A-Za-z0-9_-]{16,}/);
  assert.equal(state0.chat.messages.length, 0);
  assert.equal(state0.opening.pending, true);

  const opening = (await request(port, "/api/opening", { method: "POST", body: "{}" })).json;
  assert.equal(opening.ok, true);
  assert.ok(opening.replies.length >= 1);

  const state1 = (await request(port, "/api/state")).json;
  assert.ok(state1.chat.messages.length >= 1);
  assert.equal(state1.opening.pending, false);

  const said = (
    await request(port, "/api/say", {
      method: "POST",
      body: JSON.stringify({ text: "今天有点累，不太想做饭了。" }),
    })
  ).json;
  assert.equal(said.ok, true);
  assert.ok(said.replies.length >= 1);
  assert.match(said.replies.map((reply) => reply.text).join(""), /累|不做|歇/);

  const trace = (await request(port, "/api/trace")).json.trace;
  assert.equal(trace.kind, "say");
  assert.ok(trace.prompt.sections.length >= 4);
  assert.ok(trace.reply.latencyMs >= 0);
  assert.ok(Array.isArray(trace.recall));
  assert.equal(typeof trace.emotion.before.label, "string");
  assert.equal(typeof trace.emotion.after.label, "string");

  const memories = (await request(port, "/api/memories")).json;
  assert.ok(memories.stats.size >= 4);
  assert.ok(memories.items.length >= 4);
  for (let i = 1; i < memories.items.length; i += 1) {
    assert.ok(Number(memories.items[i - 1].createdAt) >= Number(memories.items[i].createdAt));
  }
  assert.ok(memories.items.some((item) => item.text.includes("累")));

  const action = (await request(port, "/api/action", { method: "POST", body: JSON.stringify({ id: "water" }) })).json;
  assert.equal(action.ok, true);
  assert.ok(action.note);
  assert.ok(action.replies.length >= 1);
  assert.equal(action.trace.kind, "action:water");

  const tick = (await request(port, "/api/tick", { method: "POST", body: "{}" })).json;
  assert.equal(tick.ok, true);
  assert.equal(typeof tick.act, "boolean");

  const rememberOff = (
    await request(port, "/api/setup", { method: "POST", body: JSON.stringify({ remember: false, proactivePerDay: 2 }) })
  ).json;
  assert.equal(rememberOff.ok, true);
  assert.equal(rememberOff.config.remember, false);
  assert.equal(rememberOff.config.proactivePerDay, 2);

  const stateAfterSetup = (await request(port, "/api/state")).json;
  assert.equal(stateAfterSetup.config.remember, false);
  assert.ok(stateAfterSetup.chat.messages.length >= 3, "重建运行时不能丢掉聊天记录");

  const archived = (await request(port, "/api/reset", { method: "POST", body: JSON.stringify({ scope: "chat" }) })).json;
  assert.equal(archived.ok, true);
  assert.ok(archived.archived >= 2);
  const stateAfterReset = (await request(port, "/api/state")).json;
  assert.equal(stateAfterReset.chat.messages.length, 0);
  assert.ok(stateAfterReset.memory.count >= 4, "清空聊天不能清掉记忆");

  const hostileHost = await request(port, "/api/state", { headers: { host: "evil.example" } });
  assert.equal(hostileHost.status, 403);

  const hostileOrigin = await request(port, "/api/say", {
    method: "POST",
    headers: { origin: "http://evil.example" },
    body: JSON.stringify({ text: "你好" }),
  });
  assert.equal(hostileOrigin.status, 403);

  const traversal = await request(port, "/..%2Fpackage.json");
  assert.ok([403, 404].includes(traversal.status));
  assert.doesNotMatch(traversal.text, /"name": "dsh-serene"/);

  if (server.exitCode !== null) assert.fail(`服务器意外退出：\n${logs}`);
});
