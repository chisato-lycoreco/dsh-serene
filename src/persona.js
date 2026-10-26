/**
 * 人格档案：数据，不是代码。
 *
 * 「她是谁」不应该烧在 .js 里，否则换一个人格就要改源码、fork 仓库。
 * 所以人格是一份 JSON，插件只负责读进来、校验、拼成 prompt 段。
 *
 * 两种形态：
 *   单文件   personas/demo.json
 *   人格包   personas/zhiyao/{persona.json, identity.md, voice.md, life.md, tastes.md, boundaries.md, opening.md}
 *
 * 包里的 .md 是可选的：没有就只用 persona.json 的结构化字段。
 * 长文放 .md 是为了能写、能 diff，不用把整段中文塞进 JSON 字符串。
 *
 * schema（除了 name 全部可选）：
 *   name        string   她叫什么
 *   id          string   数据分桶用的稳定 id，缺省用目录名 / 文件名
 *   role        string   她和你是什么关系
 *   summary     string   一段自述
 *   traits      string[] 性格关键词
 *   speech      string[] 说话方式（长度、口头禅、回避什么）
 *   boundaries  string[] 她不会做的事
 *   lexicon     object   { address: string[], affection: string[], jealousy: string[], ... }
 *                        见 core/lexicon.js：默认只认中立说法，关系性的词要她自带
 *   routine     object   { weekday: Slot[], weekend: Slot[] } 她的一天，见 core/life.js；
 *                        不给就用普通人的作息
 *   hemisphere  string   "north"（默认）或 "south"：季节按哪边算
 *   beliefs     object[] 她本来就有的看法 [{topic, stance, confidence}]
 *   crystals    object   结晶层种子 { lessons: [], dispositions: [] }，见 core/crystal.js
 *   baseline    object   三层初始状态，缺省用 core 的 BASELINE
 */

import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { normalizeBeliefs } from "../core/beliefs.js";
import { normalizeCrystals } from "../core/crystal.js";
import { BASELINE, normalizeLayer } from "../core/emotion.js";
import { normalizeRoutine } from "../core/life.js";
import { LEXICON_GROUPS } from "../core/lexicon.js";

/** 人格包里允许出现的 .md。顺序就是拼接顺序（先身份，后细节）。 */
export const PERSONA_SECTIONS = Object.freeze(["identity", "voice", "life", "tastes", "boundaries", "opening"]);

export function loadPersona(source, { root } = {}) {
  const path = resolvePersonaPath(source, root);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new Error(`读不到人格档案 ${path}：${error.message}`);
  }
  const dir = stat.isDirectory() ? path : null;
  const file = dir ? join(dir, "persona.json") : path;

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`读不到人格档案 ${file}：${error.message}`);
  }
  return definePersona(raw, { path: file, dir });
}

export function definePersona(raw, { path = "", dir = null } = {}) {
  const name = String(raw?.name ?? "").trim();
  if (!name) throw new Error(`人格档案缺少 name：${path || "(inline)"}`);
  const list = (value) => (Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []);
  const lexicon = {};
  const address = list(raw?.lexicon?.address);
  if (address.length) lexicon.address = address;
  for (const group of LEXICON_GROUPS) {
    const words = list(raw?.lexicon?.[group]);
    if (words.length) lexicon[group] = words;
  }
  const sections = {};
  for (const key of PERSONA_SECTIONS) {
    const text = dir ? readOptional(join(dir, `${key}.md`)) : "";
    if (text) sections[key] = text;
  }
  const id = String(raw?.id ?? "").trim() || (dir ? basename(dir) : basename(path, ".json")) || "persona";
  return {
    id,
    name,
    path,
    dir,
    role: String(raw?.role ?? "").trim(),
    summary: String(raw?.summary ?? "").trim(),
    traits: list(raw?.traits),
    speech: list(raw?.speech),
    boundaries: list(raw?.boundaries),
    sections,
    routine: normalizeRoutine(raw?.routine),
    hemisphere: raw?.hemisphere === "south" ? "south" : "north",
    beliefs: normalizeBeliefs(raw?.beliefs),
    crystals: normalizeCrystals(raw?.crystals),
    lexicon,
    baseline: {
      background: normalizeLayer(raw?.baseline?.background, BASELINE.background),
      primary: normalizeLayer(raw?.baseline?.primary, BASELINE.primary),
      social: normalizeLayer(raw?.baseline?.social, BASELINE.social),
    },
  };
}

function resolvePersonaPath(source, root) {
  const value = String(source ?? "").trim();
  if (!value) throw new Error("没有指定人格档案");
  const base = root ?? process.cwd();
  const direct = isAbsolute(value) ? value : join(base, value);
  if (isDirectory(direct)) return direct;
  if (isFile(direct)) return direct;
  const withJson = direct.endsWith(".json") ? direct : `${direct}.json`;
  if (isFile(withJson)) return withJson;
  // 不存在时把最可能的路径带进错误里，省一次猜。
  return withJson;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readOptional(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * 人格档案 → 一段可以进 system prompt 的文本。
 *
 * 只写「她是谁」，不写「她此刻怎么样」——后者是情感层的活，
 * 两块分开注入，才能让状态自己走路。
 *
 * @param {object} persona
 * @param {{maxChars?: number}} [options] 超长时按句号截断，避免人格块挤掉别的段
 */
export function buildPersonaBlock(persona, { maxChars = 2000 } = {}) {
  const clause = (text) => String(text ?? "").trim().replace(/[。.！!；;，,、\s]+$/, "");
  const lines = [`你叫${persona.name}。`];
  if (persona.role) lines.push(`你和对方的关系：${clause(persona.role)}。`);
  if (persona.summary) lines.push(`${clause(persona.summary)}。`);
  if (persona.traits.length) lines.push(`你的性格：${clause(persona.traits.join("、"))}。`);
  if (persona.speech.length) lines.push(`你说话的方式：${clause(persona.speech.join("；"))}。`);
  if (persona.boundaries.length) lines.push(`你不会做的事：${clause(persona.boundaries.join("；"))}。`);
  for (const key of ["identity", "voice", "life", "tastes", "boundaries"]) {
    const text = persona.sections?.[key];
    if (text) lines.push("", text);
  }
  lines.push("", "保持这个身份说话；不要自称 AI、助手或模型，也不要解释这套设定。");
  return trimToBudget(lines.join("\n"), maxChars);
}

/** 按句号截断，不硬切字。超了就把最后一句去掉再补省略号。 */
export function trimToBudget(text, maxChars) {
  const value = String(text ?? "").trim();
  if (value.length <= maxChars) return value;
  const head = value.slice(0, maxChars);
  const cut = Math.max(head.lastIndexOf("。"), head.lastIndexOf("\n"));
  return `${(cut > maxChars * 0.5 ? head.slice(0, cut + 1) : head).trimEnd()}…`;
}
