/**
 * 人格档案：数据，不是代码。
 *
 * 「她是谁」不应该烧在 .js 里，否则换一个人格就要改源码、fork 仓库。
 * 所以人格是一份 JSON，插件只负责读进来、校验、拼成 prompt 段。
 *
 * schema（全部可选，除了 name）：
 *   name        string   她叫什么
 *   role        string   她和你是什么关系
 *   summary     string   一段自述
 *   traits      string[] 性格关键词
 *   speech      string[] 说话方式（长度、口头禅、回避什么）
 *   boundaries  string[] 她不会做的事
 *   lexicon     object   { address: string[] } 她认得出的称呼
 *   baseline    object   三层初始状态，缺省用 core 的 BASELINE
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { BASELINE, normalizeLayer } from "../core/emotion.js";

export function loadPersona(source, { root } = {}) {
  const path = resolvePersonaPath(source, root);
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`读不到人格档案 ${path}：${error.message}`);
  }
  return definePersona(raw, { path });
}

export function definePersona(raw, { path = "" } = {}) {
  const name = String(raw?.name ?? "").trim();
  if (!name) throw new Error(`人格档案缺少 name：${path || "(inline)"}`);
  const list = (value) => (Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []);
  return {
    name,
    role: String(raw?.role ?? "").trim(),
    summary: String(raw?.summary ?? "").trim(),
    traits: list(raw?.traits),
    speech: list(raw?.speech),
    boundaries: list(raw?.boundaries),
    lexicon: { address: list(raw?.lexicon?.address) },
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
  if (isAbsolute(value)) return value;
  if (value.endsWith(".json")) return join(base, value);
  return join(base, `${value}.json`);
}

/**
 * 人格档案 → 一段可以进 system prompt 的文本。
 *
 * 只写「她是谁」，不写「她此刻怎么样」——后者是情感层的活，
 * 两块分开注入，才能让状态自己走路。
 */
export function buildPersonaBlock(persona) {
  const lines = [`你叫${persona.name}。`];
  if (persona.role) lines.push(`你和对方的关系：${persona.role}。`);
  if (persona.summary) lines.push(persona.summary);
  if (persona.traits.length) lines.push(`你的性格：${persona.traits.join("、")}。`);
  if (persona.speech.length) lines.push(`你说话的方式：${persona.speech.join("；")}。`);
  if (persona.boundaries.length) lines.push(`你不会做的事：${persona.boundaries.join("；")}。`);
  lines.push("保持这个身份说话；不要自称 AI、助手或模型，也不要解释这套设定。");
  return lines.join("\n");
}
