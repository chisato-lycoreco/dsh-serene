/**
 * scripts/cdp.mjs — 一个很小的 Chrome DevTools Protocol 客户端。
 *
 * 只为两件事存在：README 的截图（scripts/shots.mjs），以及开发时看一眼
 * 页面到底长什么样。不引入 Playwright / Puppeteer，也不改页面代码。
 *
 * 用法：
 *   const browser = await launchBrowser({ port: 9333 });
 *   const page = await browser.newPage();
 *   await page.setViewport(1440, 900);
 *   await page.navigate("http://127.0.0.1:4399/");
 *   await page.screenshot("shot.png");
 *   console.log(browser.errors);
 *   await browser.close();
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.SERENE_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function findBrowser() {
  for (const candidate of CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("没找到 Chrome / Edge。装一个，或者用 SERENE_BROWSER 指定路径。");
}

class Connection {
  #ws;
  #seq = 0;
  #pending = new Map();
  #listeners = new Map();
  #closed = false;

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => this.#onMessage(event.data));
    ws.addEventListener("close", () => {
      this.#closed = true;
      for (const { reject } of this.#pending.values()) reject(new Error("浏览器连接断开了。"));
      this.#pending.clear();
    });
  }

  static async open(url, timeoutMs = 8000) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连不上浏览器调试端口。")), timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("连不上浏览器调试端口。"));
      });
    });
    return new Connection(ws);
  }

  send(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error("浏览器连接已关闭。"));
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, new Set());
    this.#listeners.get(method).add(listener);
  }

  close() {
    this.#closed = true;
    try {
      this.#ws.close();
    } catch {
      // 已经断了。
    }
  }

  #onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    const listeners = this.#listeners.get(message.method);
    if (listeners) for (const listener of listeners) listener(message.params);
  }
}

export class Page {
  constructor(cdp, sessionId = null) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  async send(method, params = {}) {
    return this.cdp.send(method, params);
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`页面脚本出错：${description}`);
    }
    return result.result?.value;
  }

  async waitFor(expression, { timeout = 12_000, interval = 120 } = {}) {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeout) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) return true;
      } catch (error) {
        lastError = error;
      }
      await sleep(interval);
    }
    throw new Error(`等不到：${expression}${lastError ? `（${lastError.message}）` : ""}`);
  }

  async setViewport(width, height, { mobile = false, deviceScaleFactor = 1 } = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
    this.width = width;
    this.height = height;
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'");
  }

  async screenshot(path, { clip, scale = 1, fullPage = false } = {}) {
    let options = { format: "png", fromSurface: true };
    if (fullPage) {
      const metrics = await this.send("Page.getLayoutMetrics");
      const size = metrics.cssContentSize ?? metrics.contentSize;
      options = {
        ...options,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
      };
    } else if (clip) {
      options = { ...options, captureBeyondViewport: true, clip: { ...clip, scale } };
    }
    const result = await this.send("Page.captureScreenshot", options);
    await writeFile(path, Buffer.from(result.data, "base64"));
    return path;
  }

  /** 拿到元素在页面坐标里的位置，截图可以按块裁。 */
  async rect(selector) {
    const rect = await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height };
    })()`);
    if (!rect) throw new Error(`页面上没有 ${selector}`);
    return rect;
  }

  async click(selector) {
    const ok = await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return false;
      node.click();
      return true;
    })()`);
    if (!ok) throw new Error(`点不到 ${selector}`);
  }
}

export async function launchBrowser({ port = 9333, browser, headless = true, profile } = {}) {
  const executable = browser ?? findBrowser();
  const userDataDir = profile ?? (await mkdtemp(join(tmpdir(), "dsh-serene-cdp-")));
  const args = [
    headless ? "--headless=new" : "--start-maximized",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--metrics-recording-only",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ];
  const child = spawn(executable, args, { stdio: "ignore", windowsHide: true });

  let version = null;
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        version = await response.json();
        break;
      }
    } catch {
      // 还没起来。
    }
    await sleep(120);
  }
  if (!version) {
    child.kill();
    throw new Error(`浏览器没有在端口 ${port} 上启动。`);
  }

  let targets = [];
  for (let i = 0; i < 20; i += 1) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    targets = list.filter((target) => target.type === "page");
    if (targets.length) break;
    await sleep(100);
  }
  if (!targets.length) {
    child.kill();
    throw new Error("浏览器没有可用的页面。");
  }

  const cdp = await Connection.open(targets[0].webSocketDebuggerUrl);
  const errors = [];
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text ?? "页面异常");
  });
  cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type !== "error") return;
    errors.push(args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  });
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry.level === "error") errors.push(entry.text);
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  const page = new Page(cdp);
  page.errors = errors;

  return {
    page,
    browser: version,
    errors,
    async newPage(url = "about:blank") {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
      const pageCdp = await Connection.open(target.webSocketDebuggerUrl);
      await pageCdp.send("Page.enable");
      await pageCdp.send("Runtime.enable");
      return new Page(pageCdp);
    },
    async close() {
      cdp.close();
      try {
        child.kill();
      } catch {
        // 已经退出。
      }
      if (!profile) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
