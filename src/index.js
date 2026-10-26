/**
 * dsh-serene — 把「人格 + 情感 + 记忆」接进 DeepSeek Harness。
 *
 * 这是一个**纯插件**：没有常驻进程、没有自己的时钟、不碰屏幕。
 * 她的状态只在 agent 调用工具时前进（见 README「两条路线」）。
 *
 * 入口契约：name / inject / Config / apply，与 DSH 其他插件一致。
 */

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import { loadPersona } from "./persona.js";
import { registerTools, registerStatusTool } from "./tools.js";
import { buildSereneSection } from "./prompt.js";
import { OpeningStore } from "./opening.js";
import { EmotionStore } from "./stores/emotion-store.js";
import { BeliefStore } from "./stores/belief-store.js";
import { CrystalStore } from "./stores/crystal-store.js";
import { ProfileStore } from "./stores/profile-store.js";
import { WeatherStore } from "./stores/weather-store.js";
import { IntrospectStore } from "./stores/introspect-store.js";
import { MemoryStore } from "./stores/memory-store.js";
import { MotivationStore } from "./stores/motivation-store.js";
import { PROACTIVE } from "../core/motivation.js";
import { reflect } from "../core/introspect.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

export const name = "dsh-serene";

/** 工具注册表 + system prompt：两个都是 DSH 内核服务，缺一个就不该挂载。 */
export const inject = ["tools", "systemPrompt"];

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description("启用人格与情感层"),
  persona: Schema.string().default("demo").description("人格：personas/ 下的名字（单文件或人格包目录），或绝对路径"),
  personaRoot: Schema.string().default("").description("人格档案目录，留空用插件自带的 personas/"),
  dataDir: Schema.string().default("").description("状态与记忆的落盘目录，留空用 $DSH_HOME/plugins/dsh-serene"),
  promptSection: Schema.boolean().default(true).description("把人格与此刻常驻进 system prompt（关掉后仍可用 serene_context 手动读）"),
  opening: Schema.boolean().default(true).description("第一次见面时，让她说一句正在发生的事"),
  recallLimit: Schema.number().min(1).max(20).step(1).default(5).description("每次召回默认条数（v2 最多 6 条）"),
  halfLifeDays: Schema.number().min(1).max(365).default(45).description("记忆时间衰减的半衰期（天），只对 v1 口径生效"),
  memoryCurve: Schema.string().default("v2").description("记忆召回口径：v2 = 允许想不起来（默认）；v1 = 旧的取前 k 条"),
  memoryCapacity: Schema.number().min(10).max(5000).step(10).default(500).description("长期记忆容量，满了按 重要度×保持率 淘汰"),
  proactivePerDay: Schema.number().min(0).max(12).step(1).default(3).description("她每天最多主动开口几次，0 = 不主动"),
  proactiveGapMinutes: Schema.number().min(10).max(360).step(5).default(60).description("两次主动之间至少隔多久（分钟）"),
  depth: Schema.string().default("normal").description("每轮给多少背景：short = 人格+此刻+外面；normal 再加记忆/看法/观察；deep 再加夜里的自省"),
  world: Schema.boolean().default(true).description("把年月日、季节（以及报进来的天气）写进【外面】"),
  introspection: Schema.boolean().default(true).description("允许夜里自省一次（只在 depth=deep 时进 prompt，也可用 serene_introspect 手动读）"),
  crystals: Schema.boolean().default(true).description("读经验与想事情的路子：想事情的路子常驻，经验由 serene_crystal 按 cue 挑一条（触发词优先）"),
});

export function apply(ctx, config = {}) {
  const options = normalizeConfig(config);
  if (!options.enabled) return;

  let persona;
  try {
    persona = loadPersona(options.persona, { root: options.personaRoot });
  } catch (error) {
    // 人格读不到时安静降级：不拖垮整个 DSH 的插件树。
    // 但不能安静到没人知道——stderr 留一行，serene_status 留一个入口。
    const reason = `人格档案加载失败：${error.message}`;
    ctx.logger?.error?.(`[dsh-serene] ${reason}（本次未启用；可调 serene_status 查看）`);
    report(reason);
    try {
      registerStatusTool(ctx, { dataDir: options.dataDir, error: reason });
    } catch (fallbackError) {
      ctx.logger?.warn?.(`[dsh-serene] 诊断工具也没能注册：${fallbackError.message}`);
    }
    return;
  }

  const dataDir = personaDataDir(options.dataDir, persona, options.persona);
  const emotion = new EmotionStore({ dir: dataDir, baseline: persona.baseline });
  const memory = new MemoryStore({ dir: dataDir, capacity: options.memoryCapacity, curve: options.memoryCurve });
  const motivation = new MotivationStore({
    dir: dataDir,
    policy: {
      ...PROACTIVE,
      perDay: options.proactivePerDay,
      minGapMinutes: options.proactiveGapMinutes,
    },
  });
  // 只有带开场文本的人格才有「第一次见面」；demo 这类示例不该被塞一句开场白。
  const opening = options.opening && persona.sections?.opening ? new OpeningStore({ dir: dataDir, personaId: persona.id }) : null;

  const beliefs = new BeliefStore({ dir: dataDir });
  const profile = new ProfileStore({ dir: dataDir });
  const weather = new WeatherStore({ dir: dataDir });
  const introspect = new IntrospectStore({ dir: dataDir });
  // 结晶层是只读的：数据由 owner 写，插件只负责过闸门、挑一条、渲染。
  const crystals = options.crystals ? new CrystalStore({ dir: dataDir, seeds: persona.crystals }) : null;

  // 夜里的自省：只有真的进了 prompt 才在收尾时记下这一晚，没显示就不算做过。
  let shownReflection = "";
  function reflectionFor(now = Date.now()) {
    if (!options.introspection || options.depth !== "deep" || !introspect.due(now)) return "";
    try {
      const text = reflect({
        snapshot: emotion.snapshot({ now }),
        memories: memory.all(),
        beliefs: [...persona.beliefs, ...beliefs.beliefs],
        profile: profile.observations,
        now,
      }).text;
      if (text) shownReflection = text;
      return text;
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-serene] 夜里自省没写成：${error.message}`);
      return "";
    }
  }

  try {
    registerTools(ctx, {
      emotion,
      memory,
      motivation,
      opening,
      persona,
      config: options,
      dataDir,
      beliefs,
      profile,
      weather,
      introspect,
      crystals,
    });
  } catch (error) {
    const reason = `工具注册失败：${error.message}`;
    ctx.logger?.error?.(`[dsh-serene] ${reason}（本次未启用；可调 serene_status 查看）`);
    report(reason);
    try {
      registerStatusTool(ctx, { dataDir, error: reason });
    } catch {
      // 连诊断工具都注册不了（宿主没提供 dsh-tools），只剩上面的 stderr。
    }
    return;
  }

  // 人格与「此刻」常驻：不调工具也知道她是谁、现在几点、在做什么。
  if (options.promptSection) {
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: "dsh-serene:persona",
        // 0 是 deployment persona 的位置；1 表示「紧跟其后，先于计划与策略」。
        order: 1,
        interpolate: false,
        text: () => {
          const now = Date.now();
          return buildSereneSection({
            persona,
            emotion,
            memory,
            opening,
            beliefs: beliefs.beliefs,
            profile: profile.observations,
            crystals: crystals?.data ?? null,
            weather: options.world ? weather.current(now) : null,
            reflection: reflectionFor(now),
            depth: options.depth,
            world: options.world,
            now,
          });
        },
      }),
    );
  }

  // 第一轮结束时把「见过」落盘。挂在 turn 的收尾而不是 prompt 装配，
  // 是为了让同一轮里的多次工具调用都还能看到开场约束。
  if (opening || (options.introspection && options.depth === "deep")) {
    try {
      ctx.on("agent/turn-stopping", () => {
        try {
          if (opening?.pending()) opening.markOpened();
          if (shownReflection) {
            introspect.mark(shownReflection, Date.now());
            shownReflection = "";
          }
        } catch (error) {
          ctx.logger?.warn?.(`[dsh-serene] 收尾时记状态失败：${error.message}`);
        }
      });
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-serene] 无法监听 turn 结束（开场会保持到下一次成功收尾）：${error.message}`);
    }
  }

  // 卸载时把内存里的状态落盘；首次加载发生在第一次工具调用，所以这里不强制写。
  ctx.effect(() => () => {
    try {
      emotion.flush();
      motivation.flush();
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-serene] 退出时保存状态失败：${error.message}`);
    }
  });

  ctx.logger?.info?.(
    `[dsh-serene] 人格「${persona.name}」已挂载${options.promptSection ? "（常驻 prompt）" : ""}，数据目录：${dataDir}`,
  );
}

/**
 * 数据按人格分桶：v0.2 只有一个 demo，数据就在 dataDir 根上；
 * 从 v0.3 起，换人格不能读到上一个人格的记忆和疤。
 *
 * 规则：demo 继续用根目录（升级不丢数据），其他人格用 `personas/<id>/`。
 */
function personaDataDir(base, persona, configured) {
  const requested = String(configured ?? "demo").trim();
  if (requested === "demo" || persona.id === "demo") return base;
  // 绝对路径 / 自定义目录：用 basename 做桶名，避免把整条路径拼进磁盘。
  const id = safeSegment(persona.id || basename(requested).replace(/\.json$/, ""));
  return join(base, "personas", id);
}

function safeSegment(value) {
  return String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 64) || "persona";
}

function normalizeConfig(config = {}) {
  const raw = config ?? {};
  const personaRoot = raw.personaRoot ? resolvePath(raw.personaRoot) : join(packageRoot, "personas");
  return {
    enabled: raw.enabled !== false,
    persona: String(raw.persona ?? "demo").trim() || "demo",
    personaRoot,
    dataDir: raw.dataDir ? resolvePath(raw.dataDir) : join(dshHome(), "plugins", "dsh-serene"),
    promptSection: raw.promptSection !== false,
    opening: raw.opening !== false,
    recallLimit: Number(raw.recallLimit) || 5,
    halfLifeDays: Number(raw.halfLifeDays) || 45,
    memoryCurve: raw.memoryCurve === "v1" ? "v1" : "v2",
    memoryCapacity: clampNumber(raw.memoryCapacity, 10, 5000, 500),
    proactivePerDay: clampNumber(raw.proactivePerDay, 0, 12, 3),
    proactiveGapMinutes: clampNumber(raw.proactiveGapMinutes, 10, 360, 60),
    depth: normalizeDepth(raw.depth),
    world: raw.world !== false,
    introspection: raw.introspection !== false,
    crystals: raw.crystals !== false,
  };
}

function normalizeDepth(value) {
  const text = String(value ?? "").trim();
  return text === "short" || text === "deep" ? text : "normal";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

/**
 * 插件没启用时，给终端留一行。
 *
 * headless / 后台启动时 logger 常常没人看，而「装好了却没生效」是最难自查的
 * 一类问题，所以这里直接写 stderr；写不出去也不影响宿主。
 */
function report(reason) {
  try {
    process.stderr.write(`[dsh-serene] ${reason}（本次未启用；可调 serene_status 查看）\n`);
  } catch {
    // stderr 被宿主接管时，只剩 serene_status 和 logger。
  }
}

function resolvePath(value) {
  const text = String(value);
  return isAbsolute(text) ? text : join(process.cwd(), text);
}
