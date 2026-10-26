/**
 * core/memes.js — 听得懂梗，但不往外抛（纯函数）
 *
 * 为什么只「认」不说：
 *   不会用梗只是少一点乐子；生硬套梗是最明显的破绽——一句话里突然蹦出一个
 *   不属于她的词，比听不懂更假。所以这一版只做「听得懂」：她知道对方在自嘲、
 *   在阴阳、在玩谐音，接话时顺着那个方向接，但不主动把梗抛回去。总闸是
 *   `memeBlock` 最后那句：「他先用，你再顺着接；他没提，你也别自己往外抛。」
 *
 * 为什么按需检索：
 *   把几百条梗塞进 system prompt，她就会每一句都想玩梗，还会把更要紧的规则
 *   挤到一边；何况九成的对话里一个梗都没有。这里只做「关键词命中 → 给一两张
 *   卡」，没命中就返回空串，一个 token 都不占。
 *
 * 为什么种子要选「长命梗」：
 *   当期热梗一周就死，写进数据里是欠债——半个月后她还在用，比不用更不像人。
 *   这里收的是能听十年的那一批。要长新的，得先真的听到、再确认用法、最后才
 *   落成卡；别照着热搜手抄。
 *
 * 每张卡存两样东西，都不是释义：
 *   `read`  别人说这句时在表达什么（人话）；
 *   `reply` 可以往哪边接（方向，不是模板）。
 * 存成「意思是……」，她就会在聊天里背词典——那比听不懂更糟。
 *
 * 和 core/ 里别处一样：不落盘、不调模型、不看时间；同样输入同样输出。
 */

/** 一条梗卡。`keys` 是命中用的说法，第一条当主键。 */
export const MEMES = [
  {
    id: "yyds",
    keys: ["yyds", "永远的神"],
    kind: "缩写",
    read: "夸到顶了，多半是玩着夸、图个热闹，不一定是认真的评价",
    reply: "跟着夸一句，或者故意抬杠「也没那么神」；别把它翻成「永远的神」讲出来",
  },
  {
    id: "xswl",
    keys: ["xswl", "笑死我了"],
    kind: "缩写",
    read: "笑到不行，一般是真的被逗到了",
    reply: "跟着笑就行，或者问他笑点在哪",
  },
  {
    id: "awsl",
    keys: ["awsl", "啊我死了"],
    kind: "缩写",
    read: "被可爱到、被戳到，夸张地表示「我不行了」",
    reply: "可以调侃他一句，别真去安慰——他不是在求助",
  },
  {
    id: "pofang",
    keys: ["破防"],
    kind: "情绪",
    read: "本来撑着的那层壳被戳破了，偏自嘲，也可能是半认真的难受",
    reply: "听语气分：笑着说的就顺着笑，真难受就软一点；别追问「你怎么了」",
  },
  {
    id: "bengbuzhu",
    keys: ["绷不住", "绷不住了"],
    kind: "情绪",
    read: "忍不住了，多指笑，也可以指哭",
    reply: "多半是笑着说的，跟着笑；要真是哭着说的就别笑了",
  },
  {
    id: "dianzhongdian",
    keys: ["典中典", "典"],
    kind: "阴阳",
    read: "太典型了，几乎是刻板印象本人，带着讥讽",
    reply: "笑一下，或者补一句更损的；别解释这个词",
  },
  {
    id: "bengbuzhule",
    keys: ["蚌埠住了"],
    kind: "谐音",
    read: "「绷不住了」的谐音，借地名玩，还是那个笑到撑不住的意思",
    reply: "跟「绷不住」一样接，笑就完了",
  },
  {
    id: "wolegedou",
    keys: ["我勒个豆", "我了个豆"],
    kind: "感叹",
    read: "「我了个去」，夸张的惊讶",
    reply: "跟着惊讶一句，或者直接问他怎么了",
  },
  {
    id: "laoliu",
    keys: ["老六"],
    kind: "人物",
    read: "背后阴人、不按套路出牌的那种人，多半是笑骂",
    reply: "可以笑骂一句，别当成真的在指控谁",
  },
  {
    id: "tuitiutiu",
    keys: ["退退退"],
    kind: "动作梗",
    read: "把不好的东西或人赶走，玩笑式的驱邪",
    reply: "跟着一起「退」，别追问为什么",
  },
  {
    id: "shuanq",
    keys: ["栓Q", "栓q"],
    kind: "谐音",
    read: "thank you 的谐音，多用来说无语、阴阳、自嘲，不是道谢",
    reply: "听出是无语就别当感谢接，可以陪他叹一句",
  },
  {
    id: "zundujiadu",
    keys: ["尊嘟假嘟"],
    kind: "卖萌",
    read: "「真的假的」，故意说得软、说得可爱",
    reply: "可以学这个语气回一句，也可以正经回答",
  },
  {
    id: "chunluren",
    keys: ["纯路人"],
    kind: "阴阳",
    read: "声明自己是中立路人，其实多半在站队",
    reply: "别被「路人」两个字骗了，按他的立场接",
  },
  {
    id: "qianfanggaoneng",
    keys: ["前方高能"],
    kind: "弹幕",
    read: "预警：接下来有刺激或离谱的东西",
    reply: "表示准备好了，或者故意说「那我不看了」",
  },
  {
    id: "kongjiang",
    keys: ["空降"],
    kind: "弹幕",
    read: "跳过片头直接到正片；也指突然冒出来",
    reply: "聊视频时就是「我跳着看的」，别当真的从天而降",
  },
  {
    id: "kaogu",
    keys: ["考古"],
    kind: "弹幕",
    read: "翻很久以前的内容，像挖出旧东西",
    reply: "可以自嘲一句「被挖坟了」，别较真",
  },
  {
    id: "leimu",
    keys: ["泪目"],
    kind: "弹幕",
    read: "感动到想哭，半夸张",
    reply: "别戳破那个夸张，顺着感动一下",
  },
  {
    id: "henghengongqing",
    keys: ["狠狠共情", "共情了"],
    kind: "情绪",
    read: "强烈认同，基本等于「我也是」",
    reply: "接一句自己的类似经历，比说「我理解你」强",
  },
  {
    id: "niuma",
    keys: ["牛马", "打工人"],
    kind: "自嘲",
    read: "自嘲是干活的牲口：累、不值钱、还得干",
    reply: "别说「你不辛苦」，那等于否定他；陪着骂两句更对",
  },
  {
    id: "shushu",
    keys: ["鼠鼠"],
    kind: "自嘲",
    read: "自嘲卑微、躲在角落的小人物",
    reply: "别居高临下地安慰，平着接就好",
  },
  {
    id: "emo",
    keys: ["emo", "emo了"],
    kind: "情绪",
    read: "情绪低落、丧，一般没到很严重的程度",
    reply: "可以问一句，别直接当成抑郁来对待",
  },
  {
    id: "shangtou",
    keys: ["上头"],
    kind: "情绪",
    read: "一时冲动、沉迷，理智暂时下线",
    reply: "可以笑他一句，也可以轻轻提醒",
  },
  {
    id: "xiatou",
    keys: ["下头"],
    kind: "情绪",
    read: "瞬间失去好感，滤镜碎了",
    reply: "问一句「怎么了」就好，别替对方辩护",
  },
  {
    id: "zhenghuo",
    keys: ["整活"],
    kind: "行为",
    read: "搞事情、玩花活，图个乐",
    reply: "可以接一句「整一个」，别泼冷水",
  },
  {
    id: "dianzizhacai",
    keys: ["电子榨菜"],
    kind: "生活",
    read: "吃饭时配着看的视频：不重要，但下饭",
    reply: "可以问他在拿什么下饭",
  },
  {
    id: "xianyanbao",
    keys: ["显眼包"],
    kind: "人物",
    read: "爱出风头、很惹眼，但多半是可爱的调侃",
    reply: "笑他就行，这不是骂人",
  },
  {
    id: "renjianqingxing",
    keys: ["人间清醒"],
    kind: "评价",
    read: "看得透、不被情绪带走；也常被拿来反讽",
    reply: "看语境：真心夸就应下，阴阳就别接这个高帽",
  },
  {
    id: "yaoyaolingxian",
    keys: ["遥遥领先"],
    kind: "玩梗",
    read: "领先很多；本来是发布会上的说法，现在多半是玩梗",
    reply: "别当正经数据接，跟着玩一句",
  },
  {
    id: "nilihmao",
    keys: ["你礼貌吗"],
    kind: "抗议",
    read: "半开玩笑的抗议：你这话有点过分了",
    reply: "要么嬉皮笑脸道个歉，要么继续怼；别当真生气",
  },
  {
    id: "xiaofacaile",
    keys: ["笑发财了", "笑不活了"],
    kind: "情绪",
    read: "笑死了的另一种说法，更夸张一点",
    reply: "跟着笑，别问「有那么好笑吗」",
  },
];

/** 词表版本：加了梗就抬一下，方便对日志。 */
export const MEMES_VERSION = "2026-10-26.1";

/** 一次最多给几张卡：两张以上她就开始挑着用，反而分心。 */
export const MEME_LIMIT = 2;

const ASCII_KEY = /^[a-z0-9]+$/;

/** 一个汉字的范围：判断单字是不是「独立出现」时用。 */
const HAN = "\u4e00-\u9fff";

/** 把命中的说法转成安全的正则片段（当前数据只有字母和汉字，这里只是兜底）。 */
function escapeKey(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 一个说法在文本里出现了没有。
 *
 * 英文缩写要卡词边界：`emo` 不能命中 `emotion`，`yyds` 不能命中 `yydsxxx`。
 * 两个汉字以上的按子串算（中文没有词边界，硬切更糟）。
 * 单个汉字只有**独立出现**才算梗：「典」单发是梗，「字典」「经典」不是——
 * 一个字嵌在词里还被当成梗，就会把无关的话也算进「抽象」那一类。
 */
function hitOf(text, key) {
  const value = String(key ?? "").toLowerCase();
  if (!value) return 0;
  const weight = 2 + Math.min(4, value.length);
  if (ASCII_KEY.test(value)) {
    return new RegExp(`(^|[^a-z0-9])${escapeKey(value)}([^a-z0-9]|$)`).test(text) ? weight : 0;
  }
  if (value.length === 1) {
    return new RegExp(`(^|[^${HAN}a-z0-9])${escapeKey(value)}([^${HAN}a-z0-9]|$)`).test(text) ? weight : 0;
  }
  return text.includes(value) ? weight : 0;
}

/** 没给 limit 就用默认值；给了就规整成非负整数，别让 NaN 把结果清空。 */
function capOf(limit) {
  const number = Number(limit);
  if (!Number.isFinite(number)) return MEME_LIMIT;
  return Math.max(0, Math.floor(number));
}

/**
 * 按这句话命中的梗，最强的排前面。
 *
 * @param {string} query 最近几句拼起来的检索词
 * @param {{limit?: number, extra?: Array<object>}} [options] `extra` 是调用方临时塞进来的卡
 * @returns {Array<object>} 命中的条目，最多 limit 条
 */
export function matchMemes(query, { limit = MEME_LIMIT, extra = [] } = {}) {
  const text = String(query ?? "").toLowerCase();
  if (!text) return [];
  const cards = Array.isArray(extra) ? [...MEMES, ...extra] : MEMES;
  const scored = [];
  for (const meme of cards) {
    if (!meme || !Array.isArray(meme.keys)) continue;
    let score = 0;
    for (const key of meme.keys) score += hitOf(text, key);
    if (score > 0) scored.push({ meme, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, capOf(limit))
    .map((item) => item.meme);
}

/**
 * 命中的梗拼成一小段 prompt。没命中返回空串，不占 token。
 *
 * 三段：一句「别按字面接」，一两张卡，一句「他先用你再接」。
 * 最后那句是这一期的总闸——只认不说。
 */
export function memeBlock(query, { limit = MEME_LIMIT, extra = [] } = {}) {
  const hits = matchMemes(query, { limit, extra });
  if (hits.length === 0) return "";

  const lines = ["他话里的这些说法你听得懂，别当字面意思接（也别解释它们是什么意思）："];
  for (const meme of hits) {
    const head = String(meme.keys?.[0] ?? meme.id ?? "");
    lines.push(`- 「${head}」：${meme.read}。接法：${meme.reply}。`);
  }
  lines.push("听着就好：他先用，你再顺着接；他没提，你也别自己往外抛。");
  return lines.join("\n");
}
