#!/usr/bin/env node
/**
 * scripts/art.mjs — 画 README 的头图（banner）。
 *
 *   node scripts/art.mjs
 *
 * 用的就是网页版那套美术：同一个背景渐变、同一个光球（web/public/index.html 里的 #i-orb）、
 * 同一套颜色（web/public/style.css 的 :root）。不引入任何依赖，靠本机 Edge/Chrome 截图。
 *
 * 输出：docs/banner.png（1400×260，2 倍图）
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DOCS = join(ROOT, "docs");

const BROWSER =
  process.env.EDGE_BIN ??
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].find((path) => existsSync(path));

const W = 1400;
const H = 260;
const SCALE = 2;

/** 光球：和 web/public/index.html 里 #i-orb 逐字一致，只是外面套了一个 viewBox。 */
const ORB = `
<svg width="150" height="150" viewBox="0 0 200 200" aria-hidden="true">
  <defs>
    <radialGradient id="orb-bg" cx="34%" cy="28%" r="82%">
      <stop offset="0%" stop-color="#2c6a63" />
      <stop offset="46%" stop-color="#123039" />
      <stop offset="100%" stop-color="#050d13" />
    </radialGradient>
    <linearGradient id="orb-wave" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#4b9d93" stop-opacity=".1" />
      <stop offset="45%" stop-color="#c8f3e7" />
      <stop offset="100%" stop-color="#6cc3b5" stop-opacity=".35" />
    </linearGradient>
    <radialGradient id="orb-core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f4fffb" />
      <stop offset="55%" stop-color="#a9eadc" stop-opacity=".65" />
      <stop offset="100%" stop-color="#a9eadc" stop-opacity="0" />
    </radialGradient>
  </defs>
  <circle cx="100" cy="100" r="98" fill="url(#orb-bg)" />
  <g fill="none" stroke="#a9eadc" stroke-linecap="round">
    <circle cx="100" cy="100" r="86" stroke-opacity=".1" stroke-width="1" />
    <circle cx="100" cy="100" r="68" stroke-opacity=".13" stroke-width="1" stroke-dasharray="2 7" />
    <circle cx="100" cy="100" r="50" stroke-opacity=".1" stroke-width="1" />
    <path d="M20 109c14-11 24-11 36 0s22 11 36 0 22-11 36 0 22 11 36 0" stroke="url(#orb-wave)" stroke-width="2.2" stroke-opacity=".9" />
    <path d="M28 124c12-8 22-8 33 0s21 8 33 0 21-8 33 0 21 8 33 0" stroke="#8fe0d2" stroke-width="1.2" stroke-opacity=".32" />
    <path d="M36 94c11-7 20-7 30 0s19 7 29 0 19-7 29 0 19 7 29 0" stroke="#8fe0d2" stroke-width="1" stroke-opacity=".16" />
  </g>
  <circle cx="100" cy="100" r="26" fill="url(#orb-core)" />
  <circle cx="100" cy="100" r="3.2" fill="#effff9" />
  <circle cx="100" cy="100" r="94" fill="none" stroke="#bff1e6" stroke-opacity=".16" stroke-width="1" />
</svg>`;

/** 右边那道很淡的“情绪曲线”，和 preview.gif 里同一句话：会衰减、有昼夜、会留疤。 */
const WAVE = `
<svg width="700" height="260" viewBox="0 0 700 260" fill="none" style="position:absolute;right:0;top:0">
  <g stroke="#8fe0d2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 130c58-20 88-20 146 0s88 20 146 0 88-20 146 0 88 20 146 0 58-12 116-16"
      stroke-width="2" stroke-opacity=".34" />
    <path d="M0 166c58-13 88-13 146 0s88 13 146 0 88-13 146 0 88 13 146 0 58-8 116-10"
      stroke-width="1.2" stroke-opacity=".2" />
    <path d="M0 198h700" stroke-width="1" stroke-opacity=".1" />
  </g>
  <path d="M470 112V222" stroke="#e0a2a2" stroke-opacity=".34" stroke-width="1" stroke-dasharray="3 6" />
  <circle cx="470" cy="198" r="3.2" fill="#e0a2a2" fill-opacity=".7" />
</svg>`;

const EN = process.argv.includes("--en");
const TAGLINE = EN ? "Not how well she acts. Whether she survives." : "陪很久，不是聊得很嗨";
const META = EN ? "PAD+ × 3 layers · decays · scars · offline" : "PAD+ × 三层 · 会衰减 · 会留疤 · 不联网";

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    position: relative;
    color: #dfece8;
    font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    background:
      radial-gradient(1100px 640px at 12% -8%, rgba(37, 104, 96, 0.30), transparent 62%),
      radial-gradient(900px 560px at 105% 8%, rgba(120, 92, 54, 0.13), transparent 60%),
      radial-gradient(1200px 800px at 60% 115%, rgba(21, 68, 76, 0.22), transparent 62%),
      #050c11;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .hair { position: absolute; left: 56px; right: 56px; bottom: 44px; height: 1px;
    background: linear-gradient(90deg, rgba(150,222,208,.28), rgba(150,222,208,.04)); }
  .serif { font-family: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif; }
  .mono { font-family: "Cascadia Mono", Consolas, "SF Mono", monospace; }
</style></head>
<body>
  <div style="position:absolute;left:56px;top:52px">${ORB}</div>

  <div style="position:absolute;left:236px;top:66px">
    <div class="mono" style="font-size:11px;letter-spacing:3.4px;color:#4f9e94">DEEPSEEK HARNESS PLUGIN</div>
    <div class="serif" style="font-size:64px;font-weight:600;letter-spacing:.04em;line-height:1.05;margin-top:6px;color:#f2fbf7">dsh-serene</div>
    <div class="serif" style="font-size:${EN ? 18 : 19}px;letter-spacing:${EN ? .04 : .16}em;color:#b9cbc6;margin-top:10px">${TAGLINE}</div>
  </div>

  <div style="position:absolute;right:60px;top:60px;text-align:right" class="mono">
    <div style="font-size:11px;letter-spacing:1.6px;color:#5c7572">${META}</div>
  </div>

  ${WAVE}
  <div class="hair"></div>
</body></html>`;

if (!BROWSER) {
  console.error("找不到 Edge/Chrome。用 EDGE_BIN=<路径> 指定。");
  process.exit(1);
}

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

mkdirSync(DOCS, { recursive: true });
const work = join(tmpdir(), "serene-art");
mkdirSync(work, { recursive: true });
const file = join(work, "banner.html");
writeFileSync(file, html, "utf8");

const png = join(work, "banner.png");
execFileSync(
  BROWSER,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--force-device-scale-factor=${SCALE}`,
    "--default-background-color=00000000",
    `--window-size=${W},${H}`,
    `--screenshot=${png}`,
    `file:///${file.replace(/\\/g, "/")}`,
  ],
  { stdio: "ignore", timeout: 60_000 },
);

// 一张纯渐变的 PNG 要 700 KB，转成 JPEG 只花 80 KB，缩到显示尺寸看不出区别。
const out = join(DOCS, EN ? "banner-en.jpg" : "banner.jpg");
try {
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", png, "-q:v", "3", out], {
    stdio: "ignore",
    timeout: 60_000,
  });
} catch {
  console.error("没有 ffmpeg，只能输出 PNG（会大很多）。装一个 ffmpeg 或设 FFMPEG_BIN。");
  process.exit(1);
}

console.log(`  头图  ${out}  （${Math.round(statSync(out).size / 1024)} KB）`);
