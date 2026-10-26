#!/usr/bin/env node
/**
 * web/server.mjs — 「知遥 · 网页版」的本机小服务器。
 *
 * 只绑 127.0.0.1，只服务 web/public 里的几个文件，只跟 DeepSeek 说一次话。
 * 没有账号、没有数据库、没有遥测；所有状态都在 ~/.dsh/plugins/dsh-serene/。
 *
 *   node web/server.mjs            正常启动（需要 key）
 *   node web/server.mjs --demo     演示台词，不联网、不需要 key
 *   node web/server.mjs --port 4400 --no-open
 */

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

import {
  DEFAULT_PORT,
  VERSION,
  baseDataDir,
  describeKey,
  packageRoot,
  readConfig,
  resolveApiKey,
  resolveModelSettings,
  resolvePersonaSource,
  writeConfig,
} from "./lib/config.mjs";
import { complete, ModelError } from "./lib/model.mjs";
import { createDemoComplete, seedDemo } from "./lib/demo.mjs";
import { checkPortBoundary } from "./lib/port-guard.mjs";
import { HttpError, SereneWeb } from "./lib/runtime.mjs";
import { Cards, attachActuals } from "./lib/watch/cards.mjs";
import { WatchCollector } from "./lib/watch/collect.mjs";
import { GATES } from "./lib/watch/extract.mjs";
import { watchPaths } from "./lib/watch/util.mjs";

const PUBLIC_DIR = join(packageRoot, "web", "public");
const BODY_LIMIT = 256 * 1024;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const demo = Boolean(args.demo);
const baseDir = resolve(
  args.data || (demo ? join(packageRoot, ".dev-data", "web-demo") : baseDataDir()),
);
if (args.fresh) {
  assertSafeFresh(baseDir);
  rmSync(baseDir, { recursive: true, force: true });
}

let config = readConfig(baseDir);
if (demo && config.persona === "zhiyao" && !existsSync(join(packageRoot, "personas", "zhiyao", "persona.json"))) {
  config = { ...config, persona: "demo" };
}

let keyState = resolveApiKey(config);
let settings = resolveModelSettings(config);
let personaSource = resolvePersonaSource({ config });
let runtime = null;

try {
  runtime = createRuntime();
} catch (error) {
  console.error("");
  console.error("  启动失败：读不到人格档案。");
  console.error(`  ${error.message}`);
  console.error("");
  console.error("  通常是压缩包没解压完整。重新下载整个文件夹再试一次。");
  console.error("");
  process.exit(1);
}

if (demo && !existsSync(join(runtime.dataDir, "chat.jsonl")) && runtime.memory.size === 0) {
  seedDemo(runtime);
}

// 看护台：和她在同一个进程里，只读 traces.jsonl 长自己的瘦记录。
// 起不来也不该拦住聊天——记一条到 stderr，页面照开。
let watch = null;
let watchCards = null;
let watchError = null;

function startWatch(target) {
  try {
    watch?.stop();
    const paths = watchPaths(target.dataDir);
    watchCards = new Cards({ dir: paths.root });
    watch = new WatchCollector({ dataDir: target.dataDir }).start();
    watchError = null;
  } catch (error) {
    watchError = String(error?.message ?? error);
    console.warn(`[web] 看护台没起来：${watchError}`);
  }
}

startWatch(runtime);

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  try {
    // 先过端口边界，再过路由：Host / Origin / Content-Type 三验。
    const boundary = checkPortBoundary(req, server.address()?.port ?? 0);
    if (boundary) return sendJson(res, boundary.status, { ok: false, error: boundary.error });
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { ok: false, error: "不支持的方法。" });
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : "服务器出了点问题，再试一次。";
    if (status >= 500) console.error(`[web] ${error?.stack || error}`);
    if (!res.headersSent) sendJson(res, status, { ok: false, error: message, code: error?.code ?? "ERROR" });
    else res.end();
  } finally {
    if (args.verbose && urlOf(req)?.startsWith("/api/")) {
      console.log(`[web] ${req.method} ${urlOf(req)} ${res.statusCode} ${Date.now() - startedAt}ms`);
    }
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !args["strict-port"]) {
    const next = (server.__port ?? DEFAULT_PORT) + 1;
    if (next <= DEFAULT_PORT + 12) {
      console.log(`  端口 ${server.__port ?? DEFAULT_PORT} 被占了，换到 ${next}。`);
      listen(next);
      return;
    }
  }
  console.error("");
  console.error(`  启动失败：${error.message}`);
  console.error("");
  process.exit(1);
});

listen(Number(args.port) || DEFAULT_PORT);

/* ───────────────────────────── HTTP ───────────────────────────── */

async function handleApi(req, res, url) {
  const path = url.pathname;
  if (req.method === "GET" && path === "/api/state") {
    return sendJson(res, 200, { ...runtime.state(), config: publicConfig() });
  }
  if (req.method === "GET" && path === "/api/config") {
    return sendJson(res, 200, { ok: true, config: publicConfig() });
  }
  if (req.method === "GET" && path === "/api/personas") {
    return sendJson(res, 200, { ok: true, personas: listPersonas(), current: runtime.persona.id });
  }
  if (req.method === "GET" && path === "/api/trace") {
    const trace = runtime.getTrace(url.searchParams.get("id") || "latest");
    if (!trace) return sendJson(res, 404, { ok: false, error: "还没有可以看的一轮。" });
    return sendJson(res, 200, { ok: true, trace });
  }
  if (req.method === "GET" && path === "/api/memories") {
    return sendJson(res, 200, { ok: true, ...runtime.memories() });
  }
  if (req.method === "GET" && path === "/api/health") {
    return sendJson(res, 200, { ok: true, version: VERSION, demo, persona: runtime.persona.id });
  }

  /* ---------- 看护台（只读她自己的落盘） ---------- */

  if (req.method === "GET" && path === "/api/watch/summary") {
    return sendJson(res, 200, { ok: true, ...watchSummary(Number(url.searchParams.get("days")) || 14) });
  }
  if (req.method === "GET" && path === "/api/watch/turns") {
    const date = String(url.searchParams.get("date") || "");
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 80));
    const all = date ? watch.turnsFor(date) : watch.turns;
    return sendJson(res, 200, { ok: true, date: date || null, total: all.length, turns: all.slice(-limit).reverse() });
  }
  if (req.method === "GET" && path === "/api/watch/metrics") {
    const days = Math.max(1, Math.min(120, Number(url.searchParams.get("days")) || 30));
    return sendJson(res, 200, { ok: true, days: watch.range(days), all: watch.daily });
  }
  if (req.method === "GET" && path === "/api/watch/cards") {
    return sendJson(res, 200, { ok: true, cards: attachActuals(watchCards.list(), watch.daily) });
  }
  if (req.method === "GET" && path === "/api/watch/gates") {
    return sendJson(res, 200, { ok: true, gates: GATES, hits: watch.gates.slice(-200).reverse() });
  }
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "不支持的方法。" });

  const body = await readJson(req);

  if (path === "/api/watch/card") {
    try {
      return sendJson(res, 200, { ok: true, card: watchCards.create(body) });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }
  if (path === "/api/watch/verdict") {
    try {
      const card = watchCards.verdict(body.id, { verdict: body.verdict, note: body.note });
      return sendJson(res, 200, { ok: true, card });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }
  if (path === "/api/watch/poll") {
    const result = watch.poll();
    watch.rollupTick();
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (path === "/api/say") {
    requireKeyIfLive();
    const result = await runtime.say(body.text);
    console.log(`[web] 说了一句 · ${result.replies.length} 条 · ${result.trace.reply.latencyMs}ms`);
    return sendJson(res, 200, { ok: true, ...result });
  }
  if (path === "/api/action") {
    requireKeyIfLive();
    const result = await runtime.action(body.id);
    console.log(`[web] 动作 ${body.id} · ${result.replies.length} 条`);
    return sendJson(res, 200, { ok: true, ...result });
  }
  if (path === "/api/tick") {
    if (demo || keyState.key) {
      const result = await runtime.tick();
      if (result?.act) console.log(`[web] 她主动开口 · ${result.replies.length} 条`);
      return sendJson(res, 200, { ok: true, ...(result ?? { act: false }) });
    }
    return sendJson(res, 200, { ok: true, act: false });
  }
  if (path === "/api/opening") {
    requireKeyIfLive();
    const result = await runtime.openFirst();
    if (result) console.log(`[web] 开场 · ${result.replies.length} 条`);
    return sendJson(res, 200, { ok: true, ...(result ?? { skipped: true }) });
  }
  if (path === "/api/setup") {
    return await setup(body, res);
  }
  if (path === "/api/reset") {
    const scope = ["chat", "memory", "all"].includes(body.scope) ? body.scope : "chat";
    const moved = runtime.archive(scope);
    rebuildRuntime();
    console.log(`[web] 已归档 ${scope} · ${moved.length} 个文件`);
    return sendJson(res, 200, { ok: true, scope, archived: moved.length, state: runtime.state(), config: publicConfig() });
  }
  return sendJson(res, 404, { ok: false, error: "没有这个接口。" });
}

async function setup(body, res) {
  const patch = {};
  const apiKey = String(body.apiKey ?? "").trim();
  if (apiKey) {
    if (!/^sk-[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
      return sendJson(res, 400, { ok: false, error: "这不像一个 DeepSeek key（一般以 sk- 开头）。再复制一次试试。", code: "BAD_KEY" });
    }
    const check = await verifyKey(apiKey, String(body.baseUrl ?? settings.baseUrl).trim() || settings.baseUrl);
    if (!check.ok && check.fatal) {
      return sendJson(res, 400, { ok: false, error: check.error, code: "BAD_KEY" });
    }
    patch.apiKey = apiKey;
    if (!check.ok) patch.warning = check.error;
  }
  if (body.model) patch.model = String(body.model).trim().slice(0, 60);
  if (body.baseUrl) patch.baseUrl = String(body.baseUrl).trim().replace(/\/+$/, "").slice(0, 200);
  if (body.persona) patch.persona = String(body.persona).trim();
  if (typeof body.remember === "boolean") patch.remember = body.remember;
  if (typeof body.crystals === "boolean") patch.crystals = body.crystals;
  if (Number.isFinite(Number(body.proactivePerDay))) patch.proactivePerDay = Number(body.proactivePerDay);

  config = writeConfig(patch, baseDir);
  keyState = resolveApiKey(config);
  settings = resolveModelSettings(config);
  const persona = resolvePersonaSource({ config });
  const changedPersona = persona.requested !== personaSource.requested;
  personaSource = persona;
  // 记忆开关和主动额度是在构造时读进运行时的，改了要重新装配；
  // 只换 key / 模型不用，闭包每次调用都会读最新的 settings。
  const runtimeChanged =
    changedPersona || patch.remember !== undefined || patch.proactivePerDay !== undefined || patch.crystals !== undefined;
  if (runtimeChanged) rebuildRuntime();
  console.log(`[web] 设置已保存${patch.apiKey ? "（key 已更新）" : ""}`);
  return sendJson(res, 200, {
    ok: true,
    warning: patch.warning ?? null,
    state: runtime.state(),
    config: publicConfig(),
  });
}

/** 用 /models 验一下 key：不花 token，也不会把 key 写进日志。 */
async function verifyKey(apiKey, baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, fatal: true, error: "key 被拒绝了。确认复制完整，或者去 platform.deepseek.com 重新建一个。" };
    }
    return { ok: false, fatal: false, error: `保存了，但验证时接口返回 ${response.status}；发消息时再看。` };
  } catch {
    return { ok: false, fatal: false, error: "保存了，但现在连不上 api.deepseek.com；等网络好了再试。" };
  } finally {
    clearTimeout(timer);
  }
}

function requireKeyIfLive() {
  if (demo) return;
  if (!keyState.key) throw new HttpError(400, "还没有 API key。先在设置里填一个。", "NEED_KEY");
}

/* ───────────────────────────── 运行时 ───────────────────────────── */

function createRuntime() {
  const completeFn = demo
    ? createDemoComplete()
    : async (options) =>
        complete({
          ...options,
          apiKey: keyState.key,
          model: settings.model,
          baseUrl: settings.baseUrl,
        });
  return new SereneWeb({
    personaName: personaSource.requested,
    personaRoot: personaSource.root,
    baseDataDir: baseDir,
    config,
    complete: completeFn,
    demo,
  });
}

function rebuildRuntime() {
  try {
    runtime?.emotion.flush?.();
    runtime?.motivation.flush?.();
  } catch {
    // 忽略：下面会重新读盘。
  }
  const next = createRuntime();
  next.state(); // 先走一遍，把坏文件暴露在启动阶段
  runtime = next;
  startWatch(next);
}

/** 看护台第一屏：今天 / 昨天 / 近 N 天 / 红线 / 变更卡 / 体检。 */
function watchSummary(days = 14) {
  if (!watch) {
    return {
      ok: true,
      date: null,
      today: null,
      yesterday: null,
      days: [],
      gates: [],
      cards: [],
      health: { ok: false, running: false, error: watchError },
      error: watchError,
    };
  }
  const summary = watch.summary({ days });
  return {
    ...summary,
    cards: attachActuals(watchCards.list(), watch.daily).slice(0, 12),
    gateCatalog: GATES,
    about: {
      mode: "record",
      persona: runtime.persona.name,
      boundary: `${summary.health.timezone} · 日界 ${String(summary.health.dayBoundaryHour).padStart(2, "0")}:00`,
      source: summary.health.traceFile,
    },
  };
}

function publicConfig() {
  const described = describeKey(keyState);
  return {
    ...described,
    model: settings.model,
    baseUrl: settings.baseUrl,
    persona: runtime.persona.id,
    personaName: runtime.persona.name,
    dataDir: runtime.dataDir,
    pluginDataDir: runtime.personaDir,
    demo,
    version: VERSION,
    remember: config.remember,
    crystals: config.crystals,
    proactivePerDay: config.proactivePerDay,
    port: server.__port ?? (Number(args.port) || DEFAULT_PORT),
  };
}

function listPersonas() {
  const root = personaSource.root;
  const found = [];
  try {
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      try {
        if (statSync(dir).isDirectory() && existsSync(join(dir, "persona.json"))) found.push(readPersonaCard(dir, name));
      } catch {
        // 跳过坏的。
      }
      if (name.endsWith(".json")) {
        const file = join(root, name);
        try {
          const raw = JSON.parse(readFileSync(file, "utf8"));
          if (raw?.name) found.push({ id: String(raw.id || name.replace(/\.json$/, "")), name: String(raw.name), role: String(raw.role ?? ""), file: name });
        } catch {
          // 跳过。
        }
      }
    }
  } catch {
    return [];
  }
  return found.sort((a, b) => (a.id === "zhiyao" ? -1 : b.id === "zhiyao" ? 1 : a.name.localeCompare(b.name, "zh")));
}

function readPersonaCard(dir, name) {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "persona.json"), "utf8"));
    return { id: String(raw.id || name), name: String(raw.name || name), role: String(raw.role ?? ""), file: `${name}/persona.json` };
  } catch {
    return { id: name, name, role: "", file: `${name}/persona.json` };
  }
}

/* ───────────────────────────── 静态文件 ───────────────────────────── */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
};

function serveStatic(req, res, pathname) {
  const clean = decodeURIComponent(pathname.split("?")[0]);
  // /watch 和 /watch/ 是一页，不是目录索引：直接给那一个文件。
  const relativePath =
    clean === "/" ? "index.html" : clean === "/watch" || clean === "/watch/" ? "watch.html" : clean.replace(/^\/+/, "");
  const file = normalize(join(PUBLIC_DIR, relativePath));
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return res.end("404");
  }
  const body = readFileSync(file);
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": body.length,
    "cache-control": "no-store",
    ...securityHeaders(),
  });
  if (req.method === "HEAD") return res.end();
  return res.end(body);
}

/* ───────────────────────────── 小工具 ───────────────────────────── */

function securityHeaders() {
  return {
    "content-security-policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  };
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    ...securityHeaders(),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, "这段太长了。"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolveBody({});
      try {
        const value = JSON.parse(raw);
        resolveBody(value && typeof value === "object" ? value : {});
      } catch {
        reject(new HttpError(400, "请求格式不对。"));
      }
    });
    req.on("error", reject);
  });
}

function parseArgs(argv) {
  const out = { open: true };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--") && !["demo", "fresh", "help"].includes(item)) continue;
    const key = item.startsWith("--") ? item.slice(2) : item;
    if (["demo", "fresh", "no-open", "help", "verbose", "strict-port"].includes(key)) {
      out[key] = true;
      if (key === "no-open") out.open = false;
      continue;
    }
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function listen(port) {
  server.__port = port;
  server.on("close", () => watch?.stop());
  server.listen(port, "127.0.0.1", () => {
    const actual = server.address().port;
    server.__port = actual;
    const url = `http://127.0.0.1:${actual}`;
    console.log("");
    console.log(`  ${runtime.persona.name} · 网页版 ${VERSION}${demo ? "（演示模式：不联网，台词固定）" : ""}`);
    console.log("");
    console.log(`  打开：${url}`);
    console.log(`  看护：${url}/watch`);
    console.log(`  数据：${runtime.dataDir}`);
    console.log(`  模型：${demo ? "演示台词" : `${settings.model}（${keyState.key ? "key 已就绪" : "还没有 key"}）`}`);
    console.log("");
    console.log("  停下来的方法：关掉这个窗口，或者按 Ctrl+C。");
    console.log("");
    if (args.open) openBrowser(url);
  });
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // 打不开浏览器就自己复制上面的地址。
  }
}

function assertSafeFresh(dir) {
  const resolved = resolve(dir);
  const allowed = [resolve(join(packageRoot, ".dev-data")), resolve(tmpdir())];
  if (!allowed.some((base) => resolved === base || resolved.startsWith(`${base}${sep}`))) {
    console.error("  --fresh 只允许清空 .dev-data 或系统临时目录里的演示数据。");
    process.exit(1);
  }
}

function urlOf(req) {
  return req.url;
}

function printHelp() {
  console.log(`知遥 · 网页版 ${VERSION}

  node web/server.mjs                 启动（默认 http://127.0.0.1:4317）
  node web/server.mjs --demo          演示模式，不联网
  node web/server.mjs --port 4400     换端口
  node web/server.mjs --no-open       不自动打开浏览器
  node web/server.mjs --data <dir>    换数据目录（测试用）
  node web/server.mjs --fresh         清空演示数据后启动（仅限 .dev-data / 临时目录）
  node web/server.mjs --verbose       打印每个请求

  key 的查找顺序：环境变量 DEEPSEEK_API_KEY → 本机设置 → ~/.dsh/.credentials.yaml → .env
`);
}

/* ───────────────────────────── 收尾 ───────────────────────────── */

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n  收到 ${signal}，正在保存她的状态……`);
  try {
    runtime?.emotion?.flush?.();
    runtime?.motivation?.flush?.();
  } catch {
    // 存不下也不能卡住退出。
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref();
}

process.on("SIGINT", () => shutdown("Ctrl+C"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  console.error("");
  console.error(`  出错了：${error?.message ?? error}`);
  console.error("  如果一直这样，把上面这行发到仓库的 Issues。");
  console.error("");
});
