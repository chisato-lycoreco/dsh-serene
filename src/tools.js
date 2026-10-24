/**
 * 工具层：把情感层和记忆层暴露给 agent。
 *
 * 全部是「读一眼 / 记一笔」这种小动作，不替模型说话，也不调模型。
 * 名字统一加 serene_ 前缀，避免和其他插件撞名。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { EVENT_EFFECTS } from "../core/emotion.js";
import { buildPersonaBlock } from "./persona.js";

/**
 * `defineTool` 由 DSH 宿主提供，不在本包的 dependencies 里。
 *
 * 这里惰性导入（而不是顶层静态 import）：万一宿主没给这个包，
 * 插件应该在「注册工具」这一步报一句人话然后安静退场，
 * 而不是让整个插件模块在求值阶段就炸掉、拖垮插件树。
 */
let defineTool = null;
let importError = null;
try {
  ({ defineTool } = await import("@deepseek-ai/dsh-tools"));
} catch (error) {
  importError = error;
}

const asText = (value) => [{ type: "text", text: String(value ?? "") }];
const stringOutput = { schema: { type: "string" }, render: (_args, value) => asText(value) };

export function registerTools(ctx, { emotion, memory, persona, config }) {
  if (typeof defineTool !== "function") {
    throw new Error(
      "无法加载 @deepseek-ai/dsh-tools（工具注册依赖 DSH 宿主提供该包）。" +
        `请确认插件运行在 DSH 宿主内。原始错误：${importError?.message ?? "未知"}`,
    );
  }
  const limitDefault = Number(config.recallLimit) || 5;
  const halfLifeDays = Number(config.halfLifeDays) || 45;
  const eventKinds = Object.keys(EVENT_EFFECTS);

  ctx.tools.register(
    defineTool({
      name: "serene_context",
      description:
        "开始一段对话前先调用：返回她的人格卡和此刻的情感状态（自然语言，不含数值）。每次新会话只调一次就够。",
      parameters: {},
      output: stringOutput,
      async execute() {
        const snapshot = emotion.snapshot();
        return `${buildPersonaBlock(persona)}\n\n${snapshot.text}`;
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "serene_mood",
      description: "读她此刻的情感状态。返回值是给她自己看的自然语言描述，不要原样念给对方。",
      parameters: {},
      output: stringOutput,
      async execute() {
        const snapshot = emotion.snapshot();
        return snapshot.text || "（她的状态还没建立起来）";
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "serene_event",
      description:
        "把刚刚发生的一件事记进她的情感层。事件会按模型确定性地改变三层状态，并可能留下疤。",
      parameters: {
        kind: {
          type: "string",
          required: true,
          description: `事件类型，可选：${eventKinds.join(" / ")}`,
        },
        intensity: {
          type: "number",
          description: "强度，0.2~1.4，默认 1。越亲近或越重的话给越高。",
        },
        note: { type: "string", description: "一句话说明发生了什么，进她的记忆索引。" },
        context: { type: "string", description: "对方原话。判断是否留疤时会用到。" },
      },
      output: stringOutput,
      async execute(args) {
        const kind = String(args.kind ?? "").trim();
        if (!EVENT_EFFECTS[kind]) {
          throw new Error(`没有这种事件：${kind}。可用：${eventKinds.join(" / ")}`);
        }
        const result = emotion.record(kind, {
          intensity: args.intensity,
          note: args.note,
          context: args.context,
        });
        const moved = result.changed
          .slice(0, 3)
          .map((item) => `${item.key}${item.delta > 0 ? "+" : ""}${item.delta}`)
          .join(" ");
        const scar = result.wound ? `；留下了一道疤（深度 ${result.wound.depth}）` : "";
        return `已记录：${kind}${moved ? `（${moved}）` : ""}${scar}`;
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "serene_remember",
      description: "把值得记住的事写进长期记忆。写之前先想清楚：一年后还需要想起它吗？",
      parameters: {
        text: { type: "string", required: true, description: "记忆内容，一句话，带上必要的时间/地点。" },
        tags: { type: "array", description: "标签，比如 [\"重要\", \"约定\"]。" },
        importance: { type: "number", description: "重要度 0~1，默认 0.5。" },
      },
      output: stringOutput,
      async execute(args) {
        const saved = memory.add({ text: args.text, tags: args.tags, importance: args.importance, source: "tool" });
        if (!saved) throw new Error("记忆内容为空，没有写入。");
        return `记住了（第 ${saved.id} 条，共 ${memory.size} 条）。`;
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "serene_recall",
      description: "按话题检索长期记忆。返回最相关的几条，带时间和分数；没有就明说没有。",
      parameters: {
        query: { type: "string", required: true, description: "要回忆的话题，可以是几个关键词。" },
        limit: { type: "number", description: `最多返回几条，默认 ${limitDefault}。` },
      },
      output: stringOutput,
      async execute(args) {
        const query = String(args.query ?? "").trim();
        if (!query) throw new Error("查询为空。");
        const limit = Math.max(1, Math.min(20, Number(args.limit) || limitDefault));
        const found = memory.recall(query, { limit, halfLifeDays });
        if (!found.length) return "没有想起相关的事。";
        return found
          .map((item, index) => {
            const when = new Date(Number(item.updatedAt ?? item.createdAt ?? Date.now())).toISOString().slice(0, 10);
            const tags = item.tags?.length ? ` #${item.tags.join(" #")}` : "";
            return `${index + 1}. [${when}｜${item.score}] ${item.text}${tags}`;
          })
          .join("\n");
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "serene_state",
      description: "调她的内部状态（调试用）：三层数值、最近事件、疤。对方看不到这些数字。",
      parameters: {},
      output: stringOutput,
      async execute() {
        const snapshot = emotion.snapshot();
        const causes = emotion.causes();
        return JSON.stringify(
          {
            layers: snapshot.layers,
            blend: snapshot.blend,
            labels: {
              background: snapshot.backgroundLabel,
              primary: snapshot.primaryLabel,
              social: snapshot.socialLabel,
            },
            tone: snapshot.tone,
            mood: snapshot.mood,
            wounds: snapshot.wounds,
            recent: causes,
          },
          null,
          2,
        );
      },
    }),
  );

  // 最后一条：无论前面注册了几个，它都在（人格失败时这是唯一的一个）。
  registerStatusTool(ctx, { persona, memory, dataDir: config.dataDir });
}

/**
 * 诊断工具：回答「插件到底挂上没有」。
 *
 * 为什么值得单独一个工具：人格是运行时读盘的，文件名写错时插件会降级成
 * 「什么都不注册」。以前那种降级对用户完全不可见——模型只能回一句
 * 「没有这个工具」，用户以为是模型不会用。现在至少有一个入口能问出原因。
 */
export function registerStatusTool(ctx, { persona = null, memory = null, dataDir = "", error = null } = {}) {
  if (typeof defineTool !== "function") {
    throw new Error(
      "无法加载 @deepseek-ai/dsh-tools（工具注册依赖 DSH 宿主提供该包）。" +
        `请确认插件运行在 DSH 宿主内。原始错误：${importError?.message ?? "未知"}`,
    );
  }

  ctx.tools.register(
    defineTool({
      name: "serene_status",
      description:
        "诊断用：确认 dsh-serene 是否真的挂载了。正常时返回人格、数据目录、记忆条数；加载失败时返回失败原因和修法。",
      parameters: {},
      output: stringOutput,
      async execute() {
        if (error) {
          return [
            "dsh-serene 已加载，但没有启用。",
            `原因：${error}`,
            "",
            "怎么修：",
            "- `config.persona` 写 `personas/` 下的文件名（默认 `demo`），或某个人格 JSON 的绝对路径；",
            "- 人格放在别处时，用 `config.personaRoot` 指向那个目录；",
            "- 改完重启 DSH，再调一次本工具确认。",
            "",
            "修好之前，其余 serene_* 工具都不会注册。",
          ].join("\n");
        }
        const stateFile = join(dataDir, "emotion.json");
        const lines = [
          "dsh-serene 已挂载。",
          `- 人格：${persona?.name ?? "(未知)"}`,
          `- 数据目录：${dataDir || "(默认)"}`,
          `- 情感状态：${existsSync(stateFile) ? `${stateFile}（已生成）` : "尚未生成，第一次记事件时创建"}`,
        ];
        if (memory) lines.push(`- 长期记忆：${memory.size} 条`);
        return lines.join("\n");
      },
    }),
  );
}
