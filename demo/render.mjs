#!/usr/bin/env node
/**
 * 把 demo/timeline.mjs 的数据画成图：
 *
 *   node demo/render.mjs            # docs/preview.gif + docs/social-preview.png
 *   node demo/render.mjs --frames   # 只出帧，不出 GIF（调样式时用）
 *
 * 依赖：无头 Edge（Windows 自带）+ ffmpeg。两者的路径可以用 EDGE_BIN / FFMPEG_BIN 覆盖。
 * 图是 SVG → PNG 截图 → GIF，全程确定性：同样的数据永远出同样的图。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { buildTimeline } from "./timeline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DOCS = join(ROOT, "docs");
const WORK = join(tmpdir(), "serene-preview");

const EDGE =
  process.env.EDGE_BIN ??
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].find((path) => existsSync(path));

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

/* ───────────────────────────── 配色 ───────────────────────────── */

// 和网页版同一套：web/public/style.css 里的 :root。
// 深海底色 + 薄荷（她）+ 沙（此刻）+ 冷银（关系）+ 淡红（疤）。
const C = {
  bg: "#050c11",
  card: "#08161c",
  panelLine: "rgba(150, 222, 208, 0.14)",
  grid: "rgba(150, 222, 208, 0.09)",
  border: "rgba(150, 222, 208, 0.16)",
  text: "#dfece8",
  dim: "#86a09c",
  faint: "#5c7572",
  background: "#8fe0d2", // 底色心境（薄荷）
  primary: "#dcc19a", // 此刻反应（沙）
  connection: "#4f9e94", // 关系温度（深薄荷）
  scar: "#e0a2a2", // 疤 / 基线（淡红）
};

/* ───────────────────────────── 画图小工具 ───────────────────────────── */

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmt = (value) => value.toFixed(1);

function chart({ points, cursor, x0, y0, w, h, min = 38, max = 78, days = 10, big = false }) {
  const X = (hour) => x0 + (hour / (days * 24)) * w;
  const Y = (value) => y0 + h - ((value - min) / (max - min)) * h;
  const visible = points.filter((p) => p.day * 24 <= cursor);
  const line = (key) => visible.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.day * 24).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(" ");

  const grid = [];
  for (const value of [40, 50, 60, 70]) {
    grid.push(`<line x1="${x0}" y1="${Y(value)}" x2="${x0 + w}" y2="${Y(value)}" stroke="${C.grid}" stroke-width="1"/>`);
    grid.push(
      `<text x="${x0 - 10}" y="${Y(value) + 4}" fill="${C.faint}" font-size="${big ? 15 : 11}" text-anchor="end">${value}</text>`,
    );
  }

  // 夜晚（23:00–07:00）：只画一条淡淡的底，让昼夜节律看得出来
  const nights = [];
  for (let day = 0; day < days; day += 1) {
    const start = Math.max(0, day * 24 + 23);
    const end = (day + 1) * 24 + 7;
    if (start >= cursor) continue;
    nights.push(
      `<rect x="${X(start)}" y="${y0}" width="${Math.max(0, X(Math.min(end, cursor)) - X(start))}" height="${h}" fill="${C.background}" opacity="0.035"/>`,
    );
  }

  const dayLabels = [];
  for (let day = 0; day < days; day += 1) {
    dayLabels.push(
      `<text x="${X(day * 24 + 12)}" y="${y0 + h + (big ? 24 : 18)}" fill="${C.faint}" font-size="${big ? 15 : 11}" text-anchor="middle">D${String(day + 1).padStart(2, "0")}</text>`,
    );
  }

  // 疤：基线在那一天被挪走，之后一直是这条虚线
  const wounds = points.filter((p) => p.note?.scar);
  const scarMarks = [];
  for (const wound of wounds) {
    const at = wound.day * 24;
    if (at > cursor) continue;
    scarMarks.push(
      `<line x1="${X(at)}" y1="${y0}" x2="${X(at)}" y2="${y0 + h}" stroke="${C.scar}" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"/>`,
    );
    scarMarks.push(
      `<text x="${X(at) + 6}" y="${y0 + (big ? 26 : 18)}" fill="${C.scar}" font-size="${big ? 15 : 11}">⚡ 疤 ×${wound.note.scar}</text>`,
    );
  }
  const baselinePath = visible
    .map((p, i) => `${i === 0 ? "M" : "L"}${X(p.day * 24).toFixed(1)},${Y(p.baselinePleasure).toFixed(1)}`)
    .join(" ");

  const dots = points
    .filter((p) => p.note && p.day * 24 <= cursor)
    .map((p) => `<circle cx="${X(p.day * 24)}" cy="${Y(p.primary)}" r="${big ? 4.5 : 3}" fill="${C.primary}" stroke="${C.bg}" stroke-width="1"/>`)
    .join("");

  // 同一句夸奖落在不同的底色上：这是整张图想说的事，给它两个字
  const affectionLabels = points
    .filter((p) => p.note?.kind === "affection" && p.day * 24 <= cursor)
    .map((p) => {
      const text = p.note.delta >= 0 ? `被夸 +${Math.round(p.note.delta)}` : `被夸 ${Math.round(p.note.delta)}`;
      return `<text x="${X(p.day * 24) - 10}" y="${Y(p.primary) - 9}" fill="${C.primary}" font-size="${big ? 15 : 11}" opacity="0.9" text-anchor="end">${esc(text)}</text>`;
    })
    .join("");

  const now = visible.at(-1) ?? points[0];
  const cx = X(now.day * 24);
  const head = `
    <line x1="${cx}" y1="${y0 - 6}" x2="${cx}" y2="${y0 + h}" stroke="${C.text}" stroke-width="1" opacity="0.35"/>
    <circle cx="${cx}" cy="${Y(now.background)}" r="${big ? 5 : 4}" fill="${C.background}"/>
    <circle cx="${cx}" cy="${Y(now.connection)}" r="${big ? 5 : 4}" fill="${C.connection}"/>
    <circle cx="${cx}" cy="${Y(now.primary)}" r="${big ? 5 : 4}" fill="${C.primary}"/>`;

  return {
    svg: `
      ${nights.join("")}
      ${grid.join("")}
      ${dayLabels.join("")}
      <path d="${baselinePath}" fill="none" stroke="${C.scar}" stroke-width="${big ? 2 : 1.4}" stroke-dasharray="5 5" opacity="0.85"/>
      <path d="${line("connection")}" fill="none" stroke="${C.connection}" stroke-width="${big ? 2.6 : 2}" opacity="0.9"/>
      <path d="${line("background")}" fill="none" stroke="${C.background}" stroke-width="${big ? 3 : 2.4}"/>
      <path d="${line("primary")}" fill="none" stroke="${C.primary}" stroke-width="${big ? 2 : 1.5}" opacity="0.85"/>
      ${scarMarks.join("")}
      ${dots}
      ${affectionLabels}
      ${head}`,
    now,
  };
}

const legend = (x, y, big = false) => {
  const items = [
    [C.background, "底色心境（慢）"],
    [C.primary, "此刻反应（快）"],
    [C.connection, "关系温度"],
    [C.scar, "疤之后的基线"],
  ];
  const size = big ? 14 : 12;
  const gap = big ? 30 : 22;
  const bar = (color, dashed) =>
    dashed
      ? `background:repeating-linear-gradient(90deg,${color} 0 4px,transparent 4px 7px)`
      : `background:${color}`;
  return `<div style="display:flex;align-items:center;gap:${gap}px;font-size:${size}px;color:${C.dim};white-space:nowrap">${items
    .map(
      ([color, label]) =>
        `<span style="display:inline-flex;align-items:center;gap:8px"><i style="display:block;width:${big ? 20 : 16}px;height:3px;border-radius:2px;${bar(color, color === C.scar)}"></i>${label}</span>`,
    )
    .join("")}</div>`;
};

const stamp = (point) => {
  const total = Math.floor(point.day * 24);
  const day = Math.floor(total / 24) + 1;
  const hour = total % 24;
  return `D${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00`;
};

const page = (body, { width, height }) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    color: ${C.text};
    font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    background:
      radial-gradient(1100px 640px at 12% -8%, rgba(37, 104, 96, 0.30), transparent 62%),
      radial-gradient(900px 560px at 105% 8%, rgba(120, 92, 54, 0.13), transparent 60%),
      radial-gradient(1200px 800px at 60% 115%, rgba(21, 68, 76, 0.22), transparent 62%),
      ${C.bg};
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .serif { font-family: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif; }
  .mono { font-family: "Cascadia Mono", Consolas, "SF Mono", monospace; }
</style></head><body>${body}</body></html>`;

/* ───────────────────────────── 帧 ───────────────────────────── */

const W = 1000;
const H = 560;

function frameHtml(timeline, cursor) {
  const { svg, now } = chart({ points: timeline.points, cursor, x0: 64, y0: 146, w: 876, h: 286 });
  const scarred = now.scars > 0;
  const finished = cursor >= 240;
  const caption = finished
    ? "十天后，基线没有回到 64 —— 疤不是回忆，是新的皮肤。"
    : now.note
      ? now.note.text
      : "时间在走，没有对话的时段也在走。";

  const stat = (x, label, value, color) => `
    <div style="position:absolute;left:${x - 660}px;top:26px">
      <div style="font-size:11px;color:${C.faint};letter-spacing:1px">${esc(label)}</div>
      <div class="mono" style="font-size:25px;font-weight:600;color:${color};margin-top:4px">${fmt(value)}</div>
    </div>`;

  return page(
    `<div style="position:absolute;left:40px;top:24px">
      <div class="mono" style="font-size:11px;color:${C.connection};letter-spacing:2.4px">DSH-SERENE · CORE/EMOTION.JS</div>
      <div class="serif" style="font-size:25px;font-weight:600;margin-top:7px;letter-spacing:.02em">十天，一个人的情绪怎么走</div>
      <div style="font-size:12.5px;color:${C.dim};margin-top:6px">同样的输入永远得到同样的曲线 —— 这张图不是手画的，是跑出来的。</div>
    </div>
    <div style="position:absolute;left:32px;top:104px;width:936px;height:384px;border-radius:18px;border:1px solid ${C.panelLine};background:linear-gradient(180deg, rgba(12, 29, 35, .66), rgba(6, 17, 22, .48));box-shadow:0 24px 80px rgba(0,0,0,.35)"></div>
    <div style="position:absolute;left:40px;top:116px">${legend(40, 116)}</div>
    <div style="position:absolute;left:660px;top:0">${stat(660, "底色", now.background, C.background)}${stat(772, "此刻", now.primary, C.primary)}${stat(884, "关系", now.connection, C.connection)}</div>
    <svg width="${W}" height="${H}" style="position:absolute;left:0;top:0">${svg}</svg>
    <div style="position:absolute;left:64px;top:466px;font-size:12.5px;color:${C.dim}" class="mono">${stamp(now)} &nbsp;·&nbsp; 此刻「${esc(now.label)}」&nbsp;·&nbsp; ${scarred ? "疤 " + now.scars + " 道" : "还没有疤"}</div>
    <div style="position:absolute;left:64px;top:496px;font-size:15px;color:${finished ? C.scar : C.text}">${esc(caption)}</div>
    <div style="position:absolute;left:64px;width:896px;top:498px;font-size:11px;color:${C.faint};text-align:right" class="mono">github.com/chisato-lycoreco/dsh-serene</div>`,
    { width: W, height: H },
  );
}

function posterHtml(timeline) {
  const { svg, now } = chart({ points: timeline.points, cursor: 240, x0: 64, y0: 218, w: 1152, h: 268, big: true });
  return page(
    `<div style="position:absolute;left:64px;top:52px">
      <div class="mono" style="font-size:15px;color:${C.connection};letter-spacing:3.4px">DSH-SERENE</div>
      <div class="serif" style="font-size:47px;font-weight:600;margin-top:12px;line-height:1.18;letter-spacing:.02em">人格是数据，情绪是状态，记忆是文件</div>
      <div style="font-size:18px;color:${C.dim};margin-top:12px">DeepSeek Harness 插件 · PAD+ 六维 × 三层 · 会衰减、有昼夜节律、会留疤</div>
    </div>
    <div style="position:absolute;left:44px;top:190px;width:1192px;height:330px;border-radius:20px;border:1px solid ${C.panelLine};background:linear-gradient(180deg, rgba(12, 29, 35, .66), rgba(6, 17, 22, .48));box-shadow:0 30px 90px rgba(0,0,0,.36)"></div>
    <div style="position:absolute;left:80px;top:196px">${legend(80, 196, true)}</div>
    <svg width="1280" height="640" style="position:absolute;left:0;top:0">${svg}</svg>
    <div style="position:absolute;left:64px;top:574px;font-size:16px;color:${C.dim}" class="mono">
      基线 ${fmt(timeline.baselineStart)} → ${fmt(timeline.baselineEnd)} &nbsp;·&nbsp; 关系 ${fmt(timeline.connectionStart)} → ${fmt(timeline.connectionEnd)} &nbsp;·&nbsp; 疤 ${timeline.wounds.length} 道
    </div>
    <div style="position:absolute;left:64px;width:1152px;top:574px;font-size:15px;color:${C.faint};text-align:right" class="mono">github.com/chisato-lycoreco/dsh-serene</div>`,
    { width: 1280, height: 640 },
  );
}

/* ───────────────────────────── 截图 ───────────────────────────── */

function shoot(html, png, width, height, index) {
  const file = join(WORK, `frame-${String(index).padStart(3, "0")}.html`);
  writeFileSync(file, html, "utf8");
  execFileSync(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${width},${height}`,
      `--screenshot=${png}`,
      `file:///${file.replace(/\\/g, "/")}`,
    ],
    { stdio: "ignore", timeout: 60_000 },
  );
}

const main = () => {
  if (!EDGE) {
    console.error("找不到 Edge/Chrome。用 EDGE_BIN=<路径> 指定。");
    process.exit(1);
  }
  mkdirSync(DOCS, { recursive: true });
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const timeline = buildTimeline();
  const FRAMES = 48;
  const step = 240 / FRAMES;

  for (let i = 0; i < FRAMES; i += 1) {
    const cursor = Math.min(240, Math.round((i + 1) * step));
    const png = join(WORK, `f-${String(i).padStart(3, "0")}.png`);
    shoot(frameHtml(timeline, cursor), png, W, H, i);
    if (i % 8 === 0) process.stdout.write(`  帧 ${i + 1}/${FRAMES}\n`);
  }

  const posterPng = join(WORK, "poster.png");
  shoot(posterHtml(timeline), posterPng, 1280, 640, 999);

  const gif = join(DOCS, "preview.gif");
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-framerate",
      "12",
      "-i",
      join(WORK, "f-%03d.png"),
      "-vf",
      "scale=1000:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.6,split[s0][s1];[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
      "-loop",
      "0",
      gif,
    ],
    { stdio: "ignore", timeout: 180_000 },
  );

  const poster = join(DOCS, "social-preview.png");
  copyFileSync(posterPng, poster);

  console.log(`\n  GIF   ${gif}  ${(statSync(gif).size / 1024).toFixed(0)} KB`);
  console.log(`  封面  ${poster}  ${(statSync(poster).size / 1024).toFixed(0)} KB`);
  console.log(`  帧目录 ${WORK}（调样式时可以直接看）\n`);
};

main();
