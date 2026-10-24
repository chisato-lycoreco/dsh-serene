/**
 * scripts/shots.mjs — 生成 README 里的截图。
 *
 * 全部用演示模式（固定台词、不联网、不需要 key）跑。每次从空数据开始，
 * 所以截图可重复，也不会碰到任何人的真实聊天记录。
 *
 *   npm run shots
 *
 * 需要本机有 Chrome 或 Edge；脚本通过 CDP 控制它，不额外装依赖。
 * 输出在 docs/screenshots/。
 */

import { spawn } from "node:child_process";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { launchBrowser } from "./cdp.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.SERENE_SHOTS_PORT ?? 4397);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = join(ROOT, ".dev-data", "shots");
const OUT = join(ROOT, "docs", "screenshots");
const TUTORIAL = join(ROOT, ".dev-data", "tutorial.html");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function api(path, body = {}) {
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} 失败：${data?.error ?? response.status}`);
  return data;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {
      // 还没起来。
    }
    await sleep(100);
  }
  throw new Error(`服务没有在 ${BASE} 上启动，看看 .dev-data/shots-server.log。`);
}

const pad = (rect, amount) => ({
  x: Math.max(0, rect.x - amount),
  y: Math.max(0, rect.y - amount),
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});

function tutorialHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>解压后双击 start-web.cmd</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; width: 1100px; height: 620px; overflow: hidden;
    display: grid; place-items: center;
    background: radial-gradient(900px 420px at 50% 0%, #12333a 0%, #08161c 55%, #050d12 100%);
    color: #e8f3f1;
    font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  }
  .stage { width: 900px; }
  .lead { display: flex; align-items: baseline; gap: 12px; margin: 0 0 14px 4px; }
  .lead b { font-size: 23px; font-weight: 600; letter-spacing: .02em; }
  .lead span { color: #8ba6a4; font-size: 13px; }
  .win {
    border: 1px solid rgba(159, 227, 212, .22); border-radius: 16px; overflow: hidden;
    background: linear-gradient(180deg, rgba(16, 38, 44, .96), rgba(8, 21, 27, .98));
    box-shadow: 0 30px 80px rgba(0, 0, 0, .45);
  }
  .bar {
    height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 16px;
    border-bottom: 1px solid rgba(159, 227, 212, .12); background: rgba(4, 12, 16, .35);
  }
  .dots { display: flex; gap: 6px; margin-right: 10px; }
  .dots i { width: 10px; height: 10px; border-radius: 50%; background: #29464c; }
  .crumb { color: #7f9998; font-size: 12.5px; }
  .crumb b { color: #cfe4e0; font-weight: 500; }
  .body { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 18px; }
  .item {
    position: relative; display: flex; align-items: center; gap: 10px;
    height: 84px; padding: 0 13px; border-radius: 11px;
    border: 1px solid rgba(159, 227, 212, .10); background: rgba(10, 26, 32, .55);
    font-size: 13.5px; color: #d6e8e4;
  }
  .item svg { flex: none; opacity: .9; }
  .item small { display: block; margin-top: 3px; color: #708b89; font-size: 10.5px; }
  .item.start {
    grid-column: span 2; border-color: rgba(159, 227, 212, .62);
    background: linear-gradient(120deg, rgba(26, 74, 74, .78), rgba(13, 42, 47, .72));
    box-shadow: 0 0 0 1px rgba(159, 227, 212, .12), 0 10px 30px rgba(0, 0, 0, .25);
  }
  .item.start .name { color: #eafff9; }
  .badge {
    position: absolute; right: 12px; top: 12px; padding: 3px 8px; border-radius: 999px;
    background: #9fe3d4; color: #06201f; font-size: 11px; font-weight: 700;
  }
  .cursor { position: absolute; right: 54px; bottom: 12px; filter: drop-shadow(0 3px 5px rgba(0,0,0,.5)); }
  .tips { display: flex; justify-content: space-between; margin: 13px 4px 0; color: #8ba6a4; font-size: 12px; }
  .tips b { color: #cfe4e0; font-weight: 500; }
</style>
<div class="stage">
  <p class="lead"><b>解压后，找到这个文件</b><span>路径里最好不要有中文和空格，比如 D:\\dsh-serene</span></p>
  <div class="win">
    <div class="bar">
      <div class="dots"><i></i><i></i><i></i></div>
      <div class="crumb">下载 &nbsp;›&nbsp; <b>dsh-serene</b></div>
    </div>
    <div class="body">
      ${folder("core", "她的人格、情绪、记忆")}
      ${folder("src", "DSH 插件本体")}
      ${folder("web", "网页版")}
      ${folder("personas", "人格包")}
      ${file("package.json", "项目说明")}
      ${file("README.md", "先读我")}
      <div class="item start">
        ${fileIcon(true)}
        <span class="name">start-web.cmd<small>Windows：双击这个</small></span>
        <span class="badge">双击我</span>
        ${cursor()}
      </div>
      ${file("start-web-demo.cmd", "先看演示，不用 key")}
    </div>
  </div>
  <p class="tips"><span><b>Windows</b> 双击 start-web.cmd　·　<b>Mac</b> 双击 start-web.command</span><span>示意图 · 第一次启动会自动打开浏览器</span></p>
</div>
</html>`;
}

function folder(name, hint) {
  return `<div class="item">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9fe3d4" stroke-width="1.4">
      <path d="M3.5 7.2a2 2 0 0 1 2-2h3.2l2 2.2h7.8a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>
    </svg>
    <span class="name">${name}<small>${hint}</small></span>
  </div>`;
}

function file(name, hint) {
  return `<div class="item">
    ${fileIcon(false)}
    <span class="name">${name}<small>${hint}</small></span>
  </div>`;
}

function fileIcon(play) {
  if (play) {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9fe3d4" stroke-width="1.4">
      <rect x="4" y="3.5" width="16" height="17" rx="2.5"/>
      <path d="M10 8.6v6.8l5.2-3.4Z" fill="#9fe3d4" stroke="none"/>
    </svg>`;
  }
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7fa3a0" stroke-width="1.4">
    <path d="M6 3.5h7l5 5v12H6Z"/><path d="M13 3.5v5h5"/>
  </svg>`;
}

function cursor() {
  return `<svg class="cursor" width="26" height="34" viewBox="0 0 26 34">
    <path d="M4 2 21 19l-7.6 1.2L17 30l-4 1.7-3.7-9.8L4 27Z" fill="#f2fffb" stroke="#06201f" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

async function main() {
  await mkdir(join(ROOT, ".dev-data"), { recursive: true });
  await mkdir(OUT, { recursive: true });
  await rm(DATA, { recursive: true, force: true });
  await writeFile(TUTORIAL, tutorialHtml(), "utf8");

  const log = await open(join(ROOT, ".dev-data", "shots-server.log"), "w");
  const server = spawn(
    process.execPath,
    [
      "web/server.mjs",
      "--demo",
      "--fresh",
      "--data",
      DATA,
      "--port",
      String(PORT),
      "--no-open",
      "--strict-port",
    ],
    { cwd: ROOT, stdio: ["ignore", log.fd, log.fd], windowsHide: true },
  );
  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });

  let browser = null;
  try {
    await waitForServer();
    if (serverExited) throw new Error("服务提前退出了。");

    console.log("1/6 造一段演示对话");
    await api("/api/opening");
    await api("/api/say", { text: "在吗" });
    await api("/api/say", { text: "今天有点累，不太想做饭了。" });
    await api("/api/action", { id: "water" });
    await api("/api/say", { text: "我最近在学做饭，煎蛋总是糊。" });

    browser = await launchBrowser({ port: 9337 });
    const page = browser.page;
    await page.setViewport(1440, 900);
    await page.navigate(`${BASE}/`);
    await page.waitFor("document.querySelectorAll('.msg').length >= 7");
    await page.evaluate("document.fonts.ready.then(() => true)");
    await sleep(600);
    await page.evaluate("(() => { const chat = document.querySelector('#chat'); chat.scrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight - 10); })()");
    await sleep(350);

    console.log("2/6 主界面");
    await page.screenshot(join(OUT, "01-chat.png"));

    console.log("3/6 此刻与情绪");
    const now = await page.rect('[data-card="now"]');
    const emotion = await page.rect('[data-card="emotion"]');
    const panel = await page.rect("#panel");
    await page.screenshot(join(OUT, "02-emotion.png"), {
      clip: {
        x: panel.x,
        y: now.y - 10,
        width: panel.width,
        height: emotion.y + emotion.height - now.y + 20,
      },
      scale: 2,
    });

    console.log("4/6 透视");
    await page.click("#btn-trace");
    await page.waitFor("document.querySelector('.trace-grid')");
    await sleep(350);
    await page.screenshot(join(OUT, "03-trace.png"), {
      clip: pad(await page.rect("#modal-card"), 26),
      scale: 1.4,
    });
    await page.evaluate("document.querySelector('#modal-close').click()");

    console.log("5/6 记忆");
    await page.click('.rail-btn[data-view="memory"]');
    await page.waitFor("document.querySelector('.memory-row')");
    await sleep(350);
    await page.screenshot(join(OUT, "04-memory.png"), {
      clip: pad(await page.rect("#modal-card"), 26),
      scale: 1.5,
    });
    await page.evaluate("document.querySelector('#modal-close').click()");

    console.log("6/6 第一次见面 + 启动示意图");
    await page.evaluate(`(() => {
      document.querySelector('#boot')?.remove();
      const messages = document.querySelector('#messages');
      if (messages) messages.innerHTML = '';
      document.querySelector('#setup').hidden = false;
    })()`);
    await sleep(350);
    await page.screenshot(join(OUT, "05-setup.png"), {
      clip: pad(await page.rect(".setup-card"), 30),
      scale: 1.6,
    });

    await page.setViewport(1100, 620);
    await page.navigate(`file:///${TUTORIAL.replaceAll("\\", "/")}`);
    await page.waitFor("document.querySelector('.win')");
    await page.evaluate("document.fonts.ready.then(() => true)");
    await sleep(300);
    await page.screenshot(join(OUT, "06-launch.png"));

    if (browser.errors.length) {
      console.warn("页面报错（截图仍然生成了，但最好看一眼）：");
      for (const error of browser.errors) console.warn("  -", error);
    }
    console.log(`完成：${OUT}`);
  } finally {
    await browser?.close().catch(() => {});
    if (!serverExited) server.kill();
    await log.close();
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
