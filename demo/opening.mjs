/**
 * demo/opening.mjs — 「开局」的确定性剧本：72 小时，不调模型。
 *
 * 跑法：npm run opening
 *
 * 它演示四件事（也是 v0.3 的验收场景）：
 *   1. 第一次见面：她先说一句此刻的事，不自我介绍；
 *   2. 心情会变：同一句话，在她被刺到之后和之前，落点不一样；
 *   3. 会记住：第二天她说得出「你最近睡得不好」；
 *   4. 会收住：第三天她知道该不该主动开口。
 *
 * 所有时间戳都是写死的，状态落在临时目录，跑完就删——不会碰到你的真实数据。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPersona } from "../src/persona.js";
import { buildSereneSection } from "../src/prompt.js";
import { OpeningStore } from "../src/opening.js";
import { EmotionStore } from "../src/stores/emotion-store.js";
import { MemoryStore } from "../src/stores/memory-store.js";
import { lifeAt } from "../core/life.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const persona = loadPersona("zhiyao", { root: join(root, "personas") });
const dataDir = mkdtempSync(join(tmpdir(), "serene-opening-"));
const emotion = new EmotionStore({ dir: dataDir, baseline: persona.baseline });
const memory = new MemoryStore({ dir: dataDir });
const opening = new OpeningStore({ dir: dataDir, personaId: persona.id });

const at = (iso) => Date.parse(iso);
const rule = (title = "") => console.log(`\n${"─".repeat(64)}${title ? `\n${title}` : ""}`);
const short = (text, max = 240) => (text.length <= max ? text : `${text.slice(0, max)}…`);

function moment(iso) {
  const life = lifeAt(at(iso), { seed: persona.id, routine: persona.routine });
  const snapshot = emotion.snapshot({ now: at(iso), asleep: life.asleep });
  return { life, snapshot };
}

function show(iso, label) {
  const { life, snapshot } = moment(iso);
  console.log(`\n[${label}] ${iso}`);
  console.log(`  此刻：${life.weekday}${life.place}｜${life.activity}`);
  console.log(`  心情：${snapshot.backgroundLabel}｜${snapshot.primaryLabel}`);
  console.log(`  时间线里的一句话：${short(snapshot.text.replace(/\n/g, " "), 150)}`);
}

function say(iso, text) {
  const result = emotion.applyMessage({ from: "me", text }, { now: at(iso), lexicon: persona.lexicon });
  console.log(`  对方：${text}`);
  console.log(`  → 落成：${result ? `${result.kind}（${result.note}）` : "（没有落成事件）"}`);
}

rule("第一夜 · 2026-10-24 周六");
console.log("她先看到的是这一段 prompt（人格部分省略，只看最后三块）：");
const first = buildSereneSection({
  persona,
  emotion,
  memory,
  opening,
  now: at("2026-10-24T21:04:00+08:00"),
});
const tail = first.slice(first.indexOf("【此刻】现在是"));
console.log(`\n${tail}`);

rule("对方开口");
say("2026-10-24T21:06:00+08:00", "你在忙吗");
say("2026-10-24T21:09:00+08:00", "我今天有点累，先不聊了，晚安");
show("2026-10-24T21:10:00+08:00", "说了晚安");

// 这一轮结束了：算「见过」。
opening.markOpened(at("2026-10-24T21:10:00+08:00"));

rule("第二天 · 2026-10-25 周日");
const second = buildSereneSection({
  persona,
  emotion,
  memory,
  opening,
  now: at("2026-10-25T10:02:00+08:00"),
});
console.log("\n第二次打开时，prompt 里已经没有【第一次见面】：");
console.log(tailOf(second));

say("2026-10-25T10:03:00+08:00", "昨天没睡好");
memory.add(
  { text: "他最近睡得不好，凌晨两三点还醒着", kind: "fact", importance: 0.7, tags: ["睡眠"] },
  { now: at("2026-10-25T10:03:30+08:00") },
);
show("2026-10-25T10:04:00+08:00", "记下一件事");

rule("第三天 · 2026-10-26 周一");
say("2026-10-26T08:31:00+08:00", "早");
say("2026-10-26T08:33:00+08:00", "我受够了，今天什么都不顺");
show("2026-10-26T08:34:00+08:00", "一句狠话");
say("2026-10-26T08:36:00+08:00", "对不起，不是冲你");
show("2026-10-26T08:37:00+08:00", "道歉之后");
const third = buildSereneSection({
  persona,
  emotion,
  memory,
  opening,
  now: at("2026-10-26T08:38:00+08:00"),
});
console.log("\n她现在记得的：");
console.log(tailOf(third));

rule("状态");
const finalState = emotion.snapshot({ now: at("2026-10-26T08:33:00+08:00") });
console.log(JSON.stringify({ labels: { background: finalState.backgroundLabel, primary: finalState.primaryLabel }, wounds: finalState.wounds.length, memories: memory.stats().size, opening: opening.snapshot() }, null, 2));

rmSync(dataDir, { recursive: true, force: true });
console.log("\n跑完了。数据在临时目录里，已经删掉。");

/** 只取【此刻】之后的两块，避免把整段人格再打一遍。 */
function tailOf(text) {
  const index = text.indexOf("【此刻】现在是");
  return index === -1 ? text : text.slice(index);
}
