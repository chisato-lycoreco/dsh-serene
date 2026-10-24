/**
 * dsh-serene — 把「人格 + 情感 + 记忆」接进 DeepSeek Harness。
 *
 * 这是一个**纯插件**：没有常驻进程、没有自己的时钟、不碰屏幕。
 * 她的状态只在 agent 调用工具时前进（见 README「两条路线」）。
 *
 * 入口契约：name / inject / Config / apply，与 DSH 其他插件一致。
 */

import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import { loadPersona } from "./persona.js";
import { registerTools } from "./tools.js";
import { EmotionStore } from "./stores/emotion-store.js";
import { MemoryStore } from "./stores/memory-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

export const name = "dsh-serene";

/** 只声明真正用到的服务：工具注册表。 */
export const inject = ["tools"];

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description("启用人格与情感层"),
  persona: Schema.string().default("demo").description("人格档案：personas/ 下的文件名，或绝对路径"),
  personaRoot: Schema.string().default("").description("人格档案目录，留空用插件自带的 personas/"),
  dataDir: Schema.string().default("").description("状态与记忆的落盘目录，留空用 $DSH_HOME/plugins/dsh-serene"),
  recallLimit: Schema.number().min(1).max(20).step(1).default(5).description("每次召回默认条数"),
  halfLifeDays: Schema.number().min(1).max(365).default(45).description("记忆时间衰减的半衰期（天）"),
});

export function apply(ctx, config = {}) {
  const options = normalizeConfig(config);
  if (!options.enabled) return;

  let persona;
  try {
    persona = loadPersona(options.persona, { root: options.personaRoot });
  } catch (error) {
    // 人格读不到时安静降级：不拖垮整个 DSH 的插件树。
    ctx.logger?.error?.(`[dsh-serene] 人格档案加载失败，本插件本次不启用：${error.message}`);
    return;
  }

  const dataDir = options.dataDir;
  const emotion = new EmotionStore({ dir: dataDir, baseline: persona.baseline });
  const memory = new MemoryStore({ dir: dataDir });

  try {
    registerTools(ctx, { emotion, memory, persona, config: options });
  } catch (error) {
    ctx.logger?.error?.(`[dsh-serene] 工具注册失败，本插件本次不启用：${error.message}`);
    return;
  }

  // 卸载时把内存里的状态落盘；首次加载发生在第一次工具调用，所以这里不强制写。
  ctx.effect(() => () => {
    try {
      emotion.flush();
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-serene] 退出时保存状态失败：${error.message}`);
    }
  });

  ctx.logger?.info?.(`[dsh-serene] 人格「${persona.name}」已挂载，数据目录：${dataDir}`);
}

function normalizeConfig(config = {}) {
  const raw = config ?? {};
  const personaRoot = raw.personaRoot ? resolvePath(raw.personaRoot) : join(packageRoot, "personas");
  return {
    enabled: raw.enabled !== false,
    persona: String(raw.persona ?? "demo").trim() || "demo",
    personaRoot,
    dataDir: raw.dataDir ? resolvePath(raw.dataDir) : join(dshHome(), "plugins", "dsh-serene"),
    recallLimit: Number(raw.recallLimit) || 5,
    halfLifeDays: Number(raw.halfLifeDays) || 45,
  };
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

function resolvePath(value) {
  const text = String(value);
  return isAbsolute(text) ? text : join(process.cwd(), text);
}
