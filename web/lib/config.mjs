/**
 * web/lib/config.mjs — 网页版放在哪、用什么 key、读哪个人格。
 *
 * 网页版是仓库里**唯一会自己调模型**的东西（插件本体不调）。所以它单独有：
 *   - 一个只存在本机的配置档：$DSH_HOME/plugins/dsh-serene/web-config.json
 *   - 一条明确的 key 查找顺序：环境变量 → 本机配置 → DSH 已经存好的 key → .env
 *   - 一个默认只绑 127.0.0.1 的端口：不做任何「远程访问」
 *
 * 数据目录跟插件共用一套分桶规则，所以在网页里聊出来的记忆，
 * 装进 DSH 之后她仍然记得（反过来也一样）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.5.0";
export const DEFAULT_PORT = 4317;
export const DEFAULT_MODEL = "deepseek-chat";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

const here = dirname(fileURLToPath(import.meta.url));
/** web/lib → 仓库根。 */
export const packageRoot = resolve(here, "..", "..");

export function dshHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), ".dsh");
}

/**
 * 插件本体和网页版共用的数据根。`SERENE_DATA_DIR` 是给测试/截图用的。
 */
export function baseDataDir({ env = process.env } = {}) {
  const override = String(env.SERENE_DATA_DIR ?? "").trim();
  if (override) return resolve(override);
  return join(dshHome(env), "plugins", "dsh-serene");
}

/** 人格分桶：demo 用根目录，其余 `personas/<id>`，与 src/index.js 保持一致。 */
export function personaDataDir(base, persona, requested) {
  const name = String(requested ?? "").trim();
  if (name === "demo" || persona.id === "demo") return base;
  return join(base, "personas", safeSegment(persona.id || name));
}

export function webDataDir(personaDir) {
  return join(personaDir, "web");
}

export function configFile(base = baseDataDir()) {
  return join(base, "web-config.json");
}

export function safeSegment(value) {
  return (
    String(value ?? "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 64) || "persona"
  );
}

const DEFAULTS = Object.freeze({
  version: 1,
  apiKey: "",
  model: DEFAULT_MODEL,
  baseUrl: DEFAULT_BASE_URL,
  persona: "zhiyao",
  remember: true,
  proactivePerDay: 3,
  depth: "normal",
});

export function readConfig(base = baseDataDir()) {
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(configFile(base), "utf8"));
  } catch {
    raw = null;
  }
  return normalizeConfig(raw);
}

export function writeConfig(patch, base = baseDataDir()) {
  const next = normalizeConfig({ ...readConfig(base), ...(patch ?? {}) });
  const file = configFile(base);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, file);
  try {
    // Windows 上 mode 不生效；这里不额外改 ACL，只保证不进 git（.gitignore 已忽略 .dev-data）。
  } catch {
    // 无所谓：配置文件本来就不该被共享。
  }
  return next;
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const persona = String(source.persona ?? DEFAULTS.persona).trim() || DEFAULTS.persona;
  const baseUrl = String(source.baseUrl ?? DEFAULTS.baseUrl).trim().replace(/\/+$/, "") || DEFAULTS.baseUrl;
  const model = String(source.model ?? DEFAULTS.model).trim() || DEFAULTS.model;
  const perDay = Number(source.proactivePerDay);
  const depth = ["short", "normal", "deep"].includes(source.depth) ? source.depth : DEFAULTS.depth;
  return {
    version: 1,
    apiKey: String(source.apiKey ?? "").trim(),
    model,
    baseUrl,
    persona,
    remember: source.remember !== false,
    proactivePerDay: Number.isFinite(perDay) ? Math.max(0, Math.min(12, Math.floor(perDay))) : DEFAULTS.proactivePerDay,
    depth,
  };
}

/**
 * 她说话要用 key。顺序固定，每一档都能在界面上说出「从哪来的」。
 *
 * @returns {{key: string|null, source: "env"|"config"|"dsh"|"dotenv"|null}}
 */
export function resolveApiKey(config = readConfig(), { env = process.env, home = homedir() } = {}) {
  const envKey = String(env.DEEPSEEK_API_KEY ?? "").trim();
  if (envKey) return { key: envKey, source: "env" };
  if (config.apiKey) return { key: config.apiKey, source: "config" };

  const credentials = join(home, ".dsh", ".credentials.yaml");
  const fromCredentials = readKeyLine(credentials, /^\s*DEEPSEEK_API_KEY:\s*['"]?(sk-[^'"\s]+)['"]?\s*$/m);
  if (fromCredentials) return { key: fromCredentials, source: "dsh" };

  for (const file of [join(home, ".dsh", ".env"), join(packageRoot, ".env")]) {
    const value = readKeyLine(file, /^\s*DEEPSEEK_API_KEY\s*=\s*['"]?(sk-[^'"\s]+)['"]?\s*$/m);
    if (value) return { key: value, source: "dotenv" };
  }
  return { key: null, source: null };
}

function readKeyLine(file, pattern) {
  try {
    if (!existsSync(file)) return null;
    const match = readFileSync(file, "utf8").match(pattern);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/** 给界面看的：不返回 key，只说有没有、尾巴四位。 */
export function describeKey(resolved) {
  if (!resolved?.key) return { hasKey: false, keySource: null, keyHint: "" };
  const tail = resolved.key.slice(-4);
  return { hasKey: true, keySource: resolved.source, keyHint: `…${tail}` };
}

export function resolvePersonaSource({ env = process.env, config }) {
  const requested = String(env.SERENE_PERSONA ?? "").trim() || String(config?.persona ?? "zhiyao").trim() || "zhiyao";
  return { requested, root: join(packageRoot, "personas") };
}

export function resolveModelSettings(config, { env = process.env } = {}) {
  return {
    model: String(env.SERENE_MODEL ?? "").trim() || config.model,
    baseUrl: String(env.DEEPSEEK_BASE_URL ?? "").trim().replace(/\/+$/, "") || config.baseUrl,
  };
}

export function isAbsolutePath(value) {
  return isAbsolute(String(value ?? ""));
}

export { DEFAULTS };
