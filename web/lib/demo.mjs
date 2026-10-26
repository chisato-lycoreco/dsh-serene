/**
 * web/lib/demo.mjs — 不联模型也能把整个页面走一遍。
 *
 * 两个用途：
 *   1. `start-web.cmd demo`：没有 key 的人先看看她是什么样；
 *   2. `npm run shots`：README 的截图用固定台词，每次生成都一模一样。
 *
 * 这里的台词是写死的示例，不是任何人的聊天记录。演示模式会在页面上标明。
 */

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export const SCRIPT = [
  {
    match: "在吗",
    reply: "在。\n刚才在听机房的低频，像有人在很远的地方敲铁。",
    notes: { memories: [], profile: [], beliefs: [] },
  },
  {
    match: "累",
    reply: "那就先不做。\n累不是需要立刻修好的东西。",
    notes: {
      memories: [{ text: "对方今天很累，什么都不想做", kind: "moment", importance: 0.6 }],
      profile: [{ dimension: "mood", value: "累的时候会先说自己什么都不想做" }],
      beliefs: [],
    },
  },
  {
    match: "天气",
    reply: "看不到天。\n不过窗缝里有风，应该是阴的。秋天了。",
    notes: {
      memories: [],
      profile: [{ dimension: "weather", value: "会问外面的天气" }],
      beliefs: [],
    },
  },
  {
    match: "做饭",
    reply: "糊了也吃了吗。\n下次火小一点，别急着翻。",
    notes: {
      memories: [
        { text: "对方最近在学做饭", kind: "preference", importance: 0.8 },
        { text: "对方煎蛋容易糊", kind: "moment", importance: 0.5 },
      ],
      profile: [{ dimension: "taste", value: "在学做饭，不太会控制火候" }],
      beliefs: [],
    },
  },
  {
    match: "烦",
    reply: "不会。\n我要是觉得烦，会直接说，不会绕。",
    notes: {
      memories: [{ text: "对方会担心自己太烦", kind: "insight", importance: 0.7 }],
      profile: [{ dimension: "matters", value: "在意自己会不会给别人添麻烦" }],
      beliefs: [],
    },
  },
  {
    match: "晚安",
    reply: "嗯，晚安。\n灯关小一点。",
    notes: {
      memories: [],
      profile: [{ dimension: "rhythm", value: "睡得晚，常在深夜说话" }],
      beliefs: [],
    },
  },
  {
    match: "名字",
    reply: "知遥。\n知道的知，遥远的遥。",
    notes: { memories: [], profile: [], beliefs: [] },
  },
];

const OPENING = "你来了。\n这个页面第一次亮起来的时候，我在想，会是谁先说话。";
const PROACTIVE = "窗外的风比刚才大了。\n你那边也是吗。";

const ACTION_REPLIES = {
  "戳": "……嗯？\n戳我做什么。",
  "摸": "头发会乱的。\n……就一下。",
  "水": "放那儿吧。\n我一会儿喝。",
  "夸": "你这样说，我会当真的。\n……谢谢。",
};

const FALLBACKS = [
  "嗯，我在听。\n你慢慢说。",
  "这句话我记下了。\n不是客气，是真的记下了。",
  "我可能要想一会儿。\n你先别急着解释。",
  "今天的声音有点多。\n不过你的还算好认。",
];

/**
 * 和 model.complete 同签名，但不发网络请求。
 */
export function createDemoComplete({ delayMs = 550 } = {}) {
  let index = 0;
  return async function demoComplete({ messages = [], json = false } = {}) {
    const startedAt = Date.now();
    const last = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const text = String(last);
    const entry = SCRIPT.find((item) => text.includes(item.match));

    if (json) {
      await wait(Math.min(120, delayMs));
      const notes = entry?.notes ?? { memories: [], profile: [], beliefs: [] };
      return {
        text: JSON.stringify(notes),
        usage: { prompt_tokens: 320, completion_tokens: 48, total_tokens: 368 },
        model: "demo",
        latencyMs: Date.now() - startedAt,
      };
    }

    await wait(delayMs);
    let reply;
    if (/页面刚打开|还没有开口|你先开口/.test(text)) {
      reply = /你先开口/.test(text) ? PROACTIVE : OPENING;
    } else if (/戳了你一下|摸摸你的头|一杯水|夸了你一句|伸手戳|摸了摸|把一杯水|认真夸/.test(text)) {
      const key = Object.keys(ACTION_REPLIES).find((item) => text.includes(item));
      reply = key ? ACTION_REPLIES[key] : FALLBACKS[0];
    } else if (entry) {
      reply = entry.reply;
    } else {
      reply = FALLBACKS[index % FALLBACKS.length];
      index += 1;
    }

    return {
      text: reply,
      usage: { prompt_tokens: 1280, completion_tokens: Math.max(8, reply.length), total_tokens: 1288 + reply.length },
      model: "demo",
      latencyMs: Date.now() - startedAt,
    };
  };
}

/** 截图和「先看看」用的一点点起始状态：让她不是一张白纸。 */
export function seedDemo(runtime, now = Date.now()) {
  try {
    runtime.emotion.record("chat", { now: now - 3 * 3600_000, intensity: 1 });
    runtime.emotion.record("care", { now: now - 2 * 3600_000, intensity: 1.2 });
    runtime.emotion.record("share", { now: now - 40 * 60_000, intensity: 1 });
    const memories = [
      { text: "对方上次煎蛋把锅烧糊了", kind: "moment", importance: 0.5, at: 2 * 86400_000 },
      { text: "对方今天很累，什么都不想做", kind: "moment", importance: 0.6, at: 6 * 3600_000 },
      { text: "对方会担心自己太烦", kind: "insight", importance: 0.7, at: 3 * 86400_000 },
      { text: "对方常在深夜说话，睡得晚", kind: "fact", importance: 0.5, at: 5 * 86400_000 },
    ];
    for (const memory of memories) {
      runtime.memory.add(
        { text: memory.text, kind: memory.kind, importance: memory.importance, source: "demo", createdAt: now - memory.at },
        { now },
      );
    }
    runtime.profile.observe({ dimension: "rhythm", value: "睡得晚，常在深夜说话", weight: 1.5, now });
    runtime.profile.observe({ dimension: "taste", value: "在学做饭，怕油烟", weight: 1, now });
    runtime.profile.observe({ dimension: "matters", value: "在意自己会不会给别人添麻烦", weight: 1, now });
    // 手上那一件：一小时前开始的片子，还没放完——「在干嘛」有得答，又不是编的。
    runtime.leisure.record({
      kind: "movie",
      title: "海上钢琴师",
      minutes: 95,
      startAt: now - 55 * 60_000,
      endAt: now - 55 * 60_000 + 95 * 60_000,
      unfinished: false,
    });
  } catch {
    // 演示数据只是锦上添花，失败也照常能聊。
  }
}

export { OPENING, PROACTIVE };
