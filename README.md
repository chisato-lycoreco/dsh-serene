# dsh-serene

[![npm](https://img.shields.io/npm/v/dsh-serene.svg)](https://www.npmjs.com/package/dsh-serene)
[![CI](https://github.com/chisato-lycoreco/dsh-serene/actions/workflows/ci.yml/badge.svg)](https://github.com/chisato-lycoreco/dsh-serene/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![DSH](https://img.shields.io/badge/dsh-0.2.1--rc.2-4d6bfe.svg)](https://deepseek-harness.github.io/deepseek-harness/)

中文 | [English](./README.en.md)

> 把「一个会记得你的角色」接进 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/)。
> 人格是数据，情绪是状态，记忆是文件——三者都可读、可改、可复现。

大多数「角色卡」是一段写在 system prompt 里的描述：模型每次都从零开始扮演，聊得越久越不像。
这个插件换一种做法：**把角色拆成可计算的状态**，让「她此刻怎么样」由时间、事件和历史决定，
而不是每次重新即兴。

- 情绪：PAD+ 六维 × 三层（底色 / 此刻 / 关系），会衰减、有昼夜节律、会留疤；
- 记忆：jsonl 落盘，按「保持 × 线索 × 重要度」的激活度召回，**允许想不起来**，公式可复算；
- 主动：每天几次的打扰预算 + 20 分钟可回收的 hold，不说也有替代动作；
- 人格：一份 JSON，换人格不用改代码。

它是 [`FRAMEWORK.md`](./FRAMEWORK.md) 里那套七层结构的最小参考实现——**只有织法，没有布**：
不包含任何私人角色、私人记忆、屏幕采集或图像生成。

![十天，一个人的情绪怎么走：底色、此刻、关系三条线，以及第 3 天留下的那道疤](https://raw.githubusercontent.com/chisato-lycoreco/dsh-serene/main/docs/preview.gif)

上面这张图不是手画的：`node demo/timeline.mjs` 用 [`core/emotion.js`](./core/emotion.js) 的纯函数跑十天，
`node demo/render.mjs` 把结果画成帧。改一行事件，整条曲线和那道疤都会跟着变——这就是「可复算」的意思。

---

## 它做什么 / 不做什么

| 做 | 不做 |
| --- | --- |
| 记录事件、推进情绪、把状态讲成人话 | 不替模型写回复，不改写对话内容 |
| 长期记忆的写入与召回 | 不自己调模型、不自己总结 |
| 主动开口的预算、hold 与替代动作 | 不自己发消息、不假装你回了 |
| 人格档案的读取与拼装 | 不读 `.env`、凭证、聊天记录原文 |
| 状态落盘（原子写）、可手改可进 git | 不联网、不上报、不采集屏幕 |

---

## 安装

要求：DSH `>= 0.2.1-rc.2`，Node `>= 22.19`。

```bash
# 从 npm 装（推荐）
dsh plugin --profile web add dsh-serene

# 从 GitHub 装（跟着 tag，不经过 npm）
dsh plugin --profile web add "github:chisato-lycoreco/dsh-serene#v0.2.0"

# 从本地目录装（开发时）
dsh plugin --profile web add "/absolute/path/to/dsh-serene"

# 从 tgz 装（去 Release 页面下 dsh-serene-0.2.0.tgz）
dsh plugin --profile web add ./dsh-serene-0.2.0.tgz
```

安装前**先完全退出 DSH**（安装会改 profile 的 `package.json` 和 `cordis.patch.yml`）。
装完用这条确认插件进了配置树：

```bash
dsh --profile web --dump-config | grep -A3 "dsh-serene"
```

不想装、只想试：用 patch 覆盖方式直接挂本地插件。

```bash
dsh --profile web --patch "/absolute/path/to/dsh-serene/cordis.patch.yml"
```

> `cordis.patch.yml` 里的 `config` 是**整段替换**，不是深合并。你在自己 profile 里覆盖配置时，
> 要把想保留的键一起写上。

### 第一次运行：凭据与自检

模型凭据只有两个来源：GUI 的 **Models 页面**写进 credentials service，或启动环境里的
`DEEPSEEK_API_KEY`。**新 profile 不会自动继承**——另建了一个 profile 时，第一句话就会报
`MISSING_CREDENTIAL`（这是凭据问题，不是插件问题）：

```bash
export DEEPSEEK_API_KEY=sk-...      # 或者先在 GUI 的 Models 页填一次
```

装完别只看配置文件。两步确认，第二步才是「真的能用」：

| 想确认 | 怎么做 | 正常时 |
| --- | --- | --- |
| 配置进了配置树 | `dsh --profile web --dump-config \| grep -A3 dsh-serene` | 有 `- id: serene` |
| 插件真的挂上 | 在**装着插件的那个 profile** 里说一句「用 serene_status 看看」 | 返回人格、数据目录、记忆条数 |

这一步也是「插件正常」和「装好了但没生效」的唯一区分点：人格文件读不到时插件会降级
（不拖垮宿主），但会留下 `serene_status` 和一行 stderr 说明原因。

---

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `persona` | `demo` | `personas/` 下的文件名，或绝对路径 |
| `personaRoot` | 插件自带 `personas/` | 人格档案目录 |
| `dataDir` | `$DSH_HOME/plugins/dsh-serene` | 状态与记忆落盘位置 |
| `recallLimit` | `5` | 每次召回默认条数；v2 口径下最多 6 条 |
| `halfLifeDays` | `45` | 记忆时间衰减半衰期，只对 v1 口径生效 |
| `memoryCurve` | `v2` | 召回口径：`v2` 允许想不起来；`v1` 回退到旧的「有分就取前 k 条」 |
| `memoryCapacity` | `500` | 长期记忆容量，满了按 重要度 × 保持率 淘汰（过期的先走） |
| `proactivePerDay` | `3` | 她每天最多主动开口几次，`0` = 不主动 |
| `proactiveGapMinutes` | `60` | 两次主动之间至少隔多久 |

覆盖示例（`~/.dsh/profiles/web/cordis.patch.yml`）：

```yaml
- insert:
    - id: serene
      name: dsh-serene
      config:
        enabled: true
        persona: xiaoman
        personaRoot: /Users/me/serene-personas
        dataDir: /Users/me/serene-data
```

---

## 工具

| 工具 | 作用 |
| --- | --- |
| `serene_context` | 人格卡 + 此刻状态。新会话开头调一次 |
| `serene_mood` | 只读此刻状态（自然语言，不含数值） |
| `serene_event` | 记一件事进情感层（31 种事件，见下） |
| `serene_remember` | 写一条长期记忆（六类之一，≤ 80 字） |
| `serene_recall` | 按话题召回记忆，带时间、类型、激活度和 id；**可以一条都不返回** |
| `serene_reinforce` | 这几条真的用进回复了才调：被想起会让它以后更容易被想起 |
| `serene_state` | 调试用：三层数值、余震、最近事件、疤、今天的主动额度 |
| `serene_proactive` | 问「现在该不该主动开口」：理由、今日额度、不说时的替代动作 |
| `serene_proactive_done` | 开口之后记一次；被拒了传 `rejected`，扣额度并冷却 |
| `serene_status` | 诊断：插件是否真的挂上；加载失败时返回原因和修法 |

事件类型：`chat / affection / address / intimacy / kiss / tease / care / humor / share /
question / goodnight / rejection / neglect / conflict / repair / scold / coax / jealousy /
ignored / selfie / reflection / heavy_reflection / sleep / wake / leisure / reply /
cold_read / warm_read / moved / disclose / suppress`。

模型什么时候调用这些工具，由你在 `AGENTS.md` 或人格卡里约定；插件不劫持对话。

---

## 数据长什么样

`$DSH_HOME/plugins/dsh-serene/emotion.json`：

```json
{
  "version": 2,
  "updatedAt": 1761288000000,
  "lastInteractionAt": 1761287900000,
  "layers": {
    "background": { "pleasure": 63.1, "arousal": 43.8, "dominance": 59.9, "curiosity": 57.4, "confidence": 61.6, "connection": 60.4 },
    "primary":    { "pleasure": 68.2, "arousal": 47.1, "dominance": 60.3, "curiosity": 58.0, "confidence": 62.1, "connection": 61.9 },
    "social":     { "pleasure": 61.4, "arousal": 43.0, "dominance": 59.5, "curiosity": 57.8, "confidence": 61.2, "connection": 61.1 }
  },
  "wounds": [],
  "residue": [{ "startedAt": 1761280000000, "kind": "conflict", "halfLifeHours": 38, "delta": { "pleasure": -22.4 } }],
  "history": [{ "kind": "affection", "at": 1761287900000, "intensity": 1 }]
}
```

`residue` 是余震：|Δ愉悦| ≥ 8 的事会在底色上留一段 24–48 小时的尾巴。它跟「此刻」不一样——
初级层一两个小时就回落，余震要过一天才散。

`memories.jsonl`：一行一条，直接 `grep` 就能找。同一个文件里有三种行：

```jsonl
{"id":"m_lq3k2_ab12","kind":"preference","text":"她怕打雷","tags":["怕"],"importance":0.9,"createdAt":1761280000000,"stability":6.9,"lastRecall":0,"recallCount":0}
{"type":"reinforce","id":"m_lq3k2_ab12","stability":9.7,"lastRecall":1761500000000,"recallCount":1,"gain":1.4,"at":1761500000000}
{"type":"forget","id":"m_old_9x","text":"去年的一次争执","reason":"capacity","at":1761600000000}
```

追加写，不改历史行：被想起就补一行 `reinforce`，被淘汰就补一行 `forget`（删了哪条必须可查），
读的时候按先后折起来。老文件不用迁移——没有 `stability` 的记忆按写入时的公式现算。

`motivation.json`：今天的主动额度、上一次开口的时间、还没退掉的 hold。

三个文件都是你的：可以备份、可以手改、可以删。删掉就是从没发生过。

---

## 0.2.0 的两个变化

**记忆换了口径：她可以想不起来。**

旧公式（v1）是 `相关度 × 时间衰减 × 重要度`，**有分就取前 k 条**——它一定会给出东西。
真实读数：平均 5.97 条、和这句话的相关度 0.05、同一条记忆被反复注入 134 次。
那不是想起来的，是钉在背景板上的。

v2 改成激活度 + 确定性抽样：

```
激活度 = 1.1·ln(保持 + 0.02) + 0.9·线索 + 0.5·重要度 + 心情染色(±0.45) + 0.4·Gumbel(seed)
保持   = (1 + 年龄 / 稳定度) ^ −0.6     稳定度初值 = 1.5 + 6 × 重要度（时刻/承诺 ×1.3）
```

一条都不满足就返回空——这一轮没有相关记忆，比硬塞两条无关的更像人。
线索低于 `minCue` 的先淘汰；最多 6 条，不足不补位。
「被想起」会按间隔效应变牢：`S' = S × (1 + 1.2 × (1 − r))`，同一刻连着想几乎不长，
隔一阵再想起来才明显。只有你确实把某条用进回复、再调 `serene_reinforce`，才算想起。

抽样噪声来自 `hash(id, 查询, 时间戳)`，不是 `Math.random`：同样的输入永远同样的结果。
写不短的记忆会被拒绝（≤ 80 字）；到 500 条开始淘汰，淘汰记录留在 jsonl 里。
想回退旧行为：`memoryCurve: v1`。

**主动有了预算，不是只有间隔。**

`serene_proactive` 回答三件事：这一次该不该开口、为什么、今天还剩几次。
两条硬约束（每天 3 次、间隔 60 分钟）之外，还有一个 20 分钟就自己过期的 hold——
「我想说，但这次不说」不能变成「我越来越不说」。不说的时候必须给一个替代动作。

---

## 换一个人格

复制 `personas/demo.json`，改几个字段，文件名当 `persona` 传进去：

```json
{
  "name": "小满",
  "role": "住在终端里的同伴",
  "summary": "你不急着给建议。",
  "traits": ["安静", "好奇"],
  "speech": ["句子短", "不确定就问"],
  "boundaries": ["不假装记得没记过的事"],
  "lexicon": { "address": ["小满"] },
  "baseline": { "background": { "pleasure": 62 } }
}
```

`baseline` 省略就用默认基线；`lexicon.address` 决定哪些称呼会被识别成「叫你」。

---

## 三条设计约定

1. **状态自己走。** 时间过去，情绪就衰减、就随昼夜波动——不需要谁说话才动。
2. **情绪只影响语气和浮现，不改写事实。** 状态进 prompt 的是一段人话（「这会儿有点低，别硬撑」），
   不是「你现在很生气」。心情会让某类记忆更容易浮起来（事实 / 知识类不染），
   但不改记忆的内容、不改真假、也不改召回公式本身。
3. **一切可复现。** 同样的初始状态 + 同样的事件 + 同样的时间戳，永远得到同样的结果；
   没有 `Math.random`（抽样噪声来自哈希）、没有模型调用。测试里跑的就是这一点。

更完整的结构说明见 [`FRAMEWORK.md`](./FRAMEWORK.md)。

---

## 开发

```bash
npm install          # 只装 devDependencies（schemastery / dsh-tools）
npm test             # node --test，55 个用例
```

```
core/emotion.js           纯函数：衰减、节律、事件、疤、余震、描述
core/recall.js            纯函数：分词、保持率、激活度、确定性抽样、强化
core/motivation.js        纯函数：意图、预算、hold、替代动作
src/stores/emotion-store.js     唯一碰磁盘的地方（原子写）
src/stores/memory-store.js      jsonl 追加、容量、召回
src/stores/motivation-store.js  今天的额度与 hold
src/persona.js            人格档案 → prompt 段
src/tools.js              10 个工具（含 serene_status 诊断）
src/index.js              name / inject / Config / apply
```

`core/` 里没有 `fs`、没有 `Date.now()`、没有网络、没有随机数。想验证：

```bash
grep -n "node:fs\|process.env\|fetch(" core/*.js   # 应该没有输出
```

`Math.random` 也不在 `core/` 里（注释里提到不算）：召回要抽样，噪声来自哈希，
所以同样的输入永远同样的结果——`test/recall-v2.test.js` 锁着这一条。

---

## 与其它插件的关系

- **灵枢（`@furongjun1999/dsh-memory`）**：那是「工作记忆」，记的是任务和事实。
  这个插件记的是「关系」，两者不要合并——工作记忆要准，关系记忆本来就会褪色。
- **dsh-dafeiyu**：桌宠形态的前端。这个插件是纯后端，没有 UI；想接桌宠，
  读 `serene_state` 的返回值自己画即可。

---

## License

代码 MIT。人格档案（`personas/`）随你改成什么样都行，改完是你的人格，不是我的。
