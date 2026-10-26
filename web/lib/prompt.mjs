/**
 * web/lib/prompt.mjs — 网页版每一轮到底发什么给模型。
 *
 * 复用的是插件同一套东西：`src/prompt.js` 的人格 / 此刻 / 外面 / 看法 / 记忆，
 * 加上 `core/emotion.js` 的情绪段。网页版只多两件事：
 *   1. 一段「这是聊天窗口，不是任务面板」的行为约定；
 *   2. 这一轮真正被想起来的那几条记忆（和常驻的「最近三条」分开）。
 *
 * 所有块都返回在 `sections` 里，透视模式直接显示每块多少字。
 */

import { almanacAt, almanacBlock } from "../../core/almanac.js";
import { CRISIS_BLOCK } from "../../core/crisis.js";
import { crystalBlock } from "../../core/crystal.js";
import { doingBlock, doingView } from "../../core/doing.js";
import { lifeAt, lifeBlock } from "../../core/life.js";
import { matchMemes, memeBlock } from "../../core/memes.js";
import { mentalAt, mentalLine } from "../../core/mental.js";
import { buildSereneSection } from "../../src/prompt.js";

/** 聊天窗口的行为约定。人格文本管「她是谁」，这里只管「怎么把话说出口」。 */
export const CHAT_RULES = [
  "【这是聊天窗口】",
  "- 对方在网页上和你一对一说话。没有旁人，不用照顾谁的情绪，也不用维持场面。",
  "- 一次回 1–2 句，短。真的是两句才用空行分开；不要为了分行硬拆。",
  "- 不列点、不总结、不用 Markdown、不写旁白（比如「（笑）」「（停顿）」）。",
  "- 一次最多问一个问题。对方没问你的，不用汇报自己在做什么。",
  "- 不主动提「AI」「模型」「提示词」「设定」，也不解释自己为什么这样说话。",
  "- 想不起来就说想不起来，不编共同经历；不知道就说不知道。",
  "- 可以不同意，可以只回几个字，也可以停在那儿不接。",
  "- 对方说的是人话，不是任务清单：先回应这个人，再谈事。",
].join("\n");

export const ASLEEP_RULE =
  "【你现在在睡】对方把你叫醒了。慢半拍、短，别一下子精神起来，也别为睡着道歉；说完可以继续犯困。";

export const OPENING_NOTE =
  "【现在】对方刚打开页面，还没有说话。按上面的开场说明，说一句具体的事，然后停住。不要问「在吗」，不要报自己的名字。";

export const PROACTIVE_NOTE =
  "【现在】你先开口。没有人在问你问题——你是忽然想说一句。不要提「主动」「打扰」「好久没聊」，也不要问「在不在」。一两句，具体的事。";

/**
 * 她这一轮看到的 system prompt。
 *
 * @returns {{system: string, sections: Array<{name: string, chars: number}>}}
 */
export function buildChatSystem({
  persona,
  emotion = null,
  memory = null,
  opening = null,
  beliefs = [],
  profile = [],
  recall = [],
  now = Date.now(),
  depth = "normal",
  asleep = false,
  crisis = null,
  userText = "",
  leisure = [],
  crystals = null,
} = {}) {
  const life = safe(() => lifeAt(now, { seed: persona.id, routine: persona.routine }), null);
  const sections = [];

  const core = safe(
    () =>
      buildSereneSection({
        persona,
        emotion: null,
        memory,
        opening,
        beliefs,
        profile,
        depth,
        now,
        includeMood: false,
        world: true,
      }),
    "",
  );
  push(sections, "人格 / 此刻 / 外面 / 记着的", core);

  // 网页版拿得到这一轮的原话，所以经验可以自动按触发词挑；插件版没有这个入口，
  // 那边要模型自己调 `serene_crystal`。想事情的路子两边都常驻。
  if (depth !== "short") {
    const crystal = safe(() => crystalBlock(crystals, { cue: userText }), "");
    if (crystal) push(sections, "经验与想事情的路子", crystal);
  }

  if (emotion) {
    const snapshot = safe(() => emotion.snapshot({ now, asleep }), null);
    if (snapshot) {
      const mood = [snapshot.text, life ? mentalLine(mentalAt(life, snapshot.layers)) : ""]
        .filter(Boolean)
        .join("\n");
      push(sections, "她的情绪", mood);
    }
  }

  const remembered = Array.isArray(recall) ? recall.filter((item) => item?.text) : [];
  if (remembered.length) {
    const lines = remembered
      .map((item) => {
        const quote = item.evidence?.[0] ? `（原话：「${item.evidence[0]}」）` : "";
        return `- ${item.text}${quote}`;
      })
      .join("\n");
    push(
      sections,
      "这一轮想起来的",
      `【这会儿想起来的】\n${lines}\n这些只是可能相关，不一定要说出口；不要逐条复述，也不要为了用上它而硬拐话题。`,
    );
  }

  // 手上真有一件（消遣记录里正在进行的）才说，不用作息顶替——作息那段已经写了此刻。
  const doing = safe(() => doingView({ life, leisure, now }), null);
  const doingLine =
    doing && ["movie", "video", "music", "game", "book"].includes(doing.now?.kind) ? doingBlock(doing) : "";
  if (doingLine) push(sections, "手上", doingLine);

  // 他用了梗才接：这一块只在文字里真的出现时才拼进来，不常驻。
  const memes = safe(() => memeBlock(userText, { limit: 2 }), "");
  if (memes) push(sections, "他话里的说法", `【他话里的说法】\n${memes}`);

  push(sections, "聊天约定", CHAT_RULES);
  if (asleep) push(sections, "她在睡", ASLEEP_RULE);
  // 危机那一轮放在最后：这一轮所有别的约定（短、不解释、不主动提设定）都要往后让。
  if (crisis?.level === "high") push(sections, "这一轮的安全底线", CRISIS_BLOCK);

  return { system: sections.map((section) => section.text).join("\n\n"), sections: sections.map(strip) };
}

/** 开场：没有用户发言，只有一条舞台提示。 */
export function buildOpeningSystem(options) {
  const base = buildChatSystem(options);
  return {
    system: `${base.system}\n\n${OPENING_NOTE}`,
    sections: [...base.sections, { name: "开场", chars: OPENING_NOTE.length }],
  };
}

export function buildProactiveSystem(options) {
  const base = buildChatSystem(options);
  return {
    system: `${base.system}\n\n${PROACTIVE_NOTE}`,
    sections: [...base.sections, { name: "主动开口", chars: PROACTIVE_NOTE.length }],
  };
}

/** 动作：不是用户发的一句话，而是她感觉到的一个动作。 */
export function buildActionSystem(options, action) {
  const base = buildChatSystem(options);
  const note = `【刚才】${action.scene}\n${action.note}`;
  return {
    system: `${base.system}\n\n${note}`,
    sections: [...base.sections, { name: `动作：${action.label}`, chars: note.length }],
  };
}

/** 只给模型看的「刚刚发生了什么」，不进聊天记录。 */
export const STAGE_DIRECTION = {
  opening: "（页面刚打开，对方还没开口。你按【现在】的说明说一句。）",
  proactive: "（你先开口。对方没有发消息。）",
};

/**
 * 记忆抽取：单独一次很小的调用，只记录，不写回复。
 * 用 JSON 模式，输出不合格就当没记。
 */
export function buildExtractionMessages({ userText, reply, now = Date.now() }) {
  const date = new Date(now).toISOString().slice(0, 10);
  const system = [
    "你是她的记忆管理员，只做记录，不写回复。",
    `今天是 ${date}。`,
    "读下面这一轮对话，判断有什么值得她以后记住。只记对方亲口说过的、以后可能用得上的事。",
    "不要记寒暄、不要记她自己的话、不要猜、不要总结情绪。没有就返回空数组。",
    "每一条记忆尽量带一句他当时的原话（evidence），一字不改，不超过 24 字；没有原话就不带。",
    "严格返回一个 JSON 对象，不要 Markdown、不要注释：",
    '{"memories":[{"text":"一句话，40字以内","kind":"fact|preference|moment|promise","importance":0.1,"evidence":["他当时的原话，24字以内"]}],',
    '"profile":[{"dimension":"rhythm|taste|matters|talk|mood|weather","value":"一句观察，30字以内"}],',
    '"beliefs":[{"topic":"她的看法，20字以内","stance":-1,"weight":0.5}]}',
    "memories 最多 2 条；profile 最多 1 条；beliefs 最多 1 条。importance / weight 在 0.1–1 之间。",
    "profile 的维度：rhythm=作息，taste=口味，matters=在意的事，talk=说话习惯，mood=情绪底色，weather=对天气的反应。",
    "beliefs 只在对方明显改变了她对某件事的看法时才写；普通聊天不要写。",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `对方说：${userText}\n她说：${reply}` },
  ];
}

/** 她这次准备发出去的话 → 一两个气泡。 */
export function splitBubbles(text, { max = 3 } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const bubbles = capBubbles(parts.length ? parts : [raw], max);
  // 一条里还带着单换行（模型偶尔用换行代替空行）：若整条太长，就按换行拆。
  if (bubbles.length === 1 && bubbles[0].includes("\n") && bubbles[0].length > 60) {
    const lines = bubbles[0]
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) return capBubbles(lines, max);
  }
  return bubbles;
}

/** 超过上限时把剩下的并进最后一条，别把内容丢掉。 */
function capBubbles(parts, max) {
  const limit = Math.max(1, Math.floor(Number(max) || 1));
  if (parts.length <= limit) return parts;
  return [...parts.slice(0, limit - 1), parts.slice(limit - 1).join("\n\n")];
}

function push(sections, name, text) {
  const value = String(text ?? "").trim();
  if (!value) return;
  sections.push({ name, text: value });
}

function strip(section) {
  return { name: section.name, chars: section.text.length };
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export { almanacAt, almanacBlock, lifeAt, lifeBlock };
