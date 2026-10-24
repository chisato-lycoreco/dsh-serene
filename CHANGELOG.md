# Changelog

## 0.3.0 — 2026-10-24

从「只有织法」到「可以开局」：仓库里多了一份人格包，插件多了一个常驻 prompt 段。
默认仍然是 `demo`——知遥要显式打开。

**知遥：`personas/zhiyao/`**

- 人格包：`persona.json` + `identity / voice / life / tastes / boundaries / opening` 六段文本 + `SOURCES.md`；
  加载器同时支持单文件（`personas/demo.json`）和目录，旧配置不受影响。
- 她的来处：一段留在机房里的程序，听鲸群的低频、海底地震、光缆的呼吸；念旧、慢、对安静有耐性。
  没有身体，没有共同过去；开场不自我介绍，也不编「我们以前」。
- 她的作息（`routine`）：每天 02:00–06:00 是低功耗，只留一只耳朵；夜里最清醒。
  槽位可以给 `energy`，不给就按普通人的一天算。
- 数据分桶：`demo` 仍用 `dataDir` 根目录（老数据不动），其他人格用 `dataDir/personas/<id>/`。

**常驻 prompt 段 + 首启**

- `ctx.systemPrompt.section({ name: "dsh-serene:persona", order: 1 })`：
  人格 + 【此刻】（时间、在做什么、心情、精神）+【第一次见面】+【你记着的】。
  关掉用 `promptSection: false`，退回「新会话调一次 `serene_context`」。
- 首启只出现一次：`opening.json` 记 `pending → opened`，`agent/turn-stopping` 时落盘。
  想重看：删文件或把 `phase` 改回 `pending`。低功耗时段被叫醒时换一句「没睡醒」的写法。
- `serene_context` / `serene_state` / `serene_status` 都带上了「此刻」：在做什么、精神怎么样、开场还没开。

**词表：默认中立**

- 新增 `core/lexicon.js`：默认词表不再含「老婆 / 宝贝 / 亲亲」这类关系性说法；
  `jealousy` 默认为空，只有人格自带才识别。人格词表只**追加**，不改默认；非法正则直接报错。
- 未知的事件类型不再默认落成 `intimacy`，改为 `chat`。

**新增文件**

- `core/life.js`：作息、精力、时间短语；同一时刻同一件事，今天和明天不同。
- `core/mental.js`：精力 / 专注 / 紧，由作息和情绪现算，不落盘。
- `src/prompt.js`、`src/opening.js`；`demo/opening.mjs`（`npm run opening`，72 小时确定性剧本）。
- 测试 68 → 76：人格包加载、数据分桶、开场只一次、作息确定性、词表中立。

## 0.2.0 — 2026-10-24

三处行为变化，不是重构：记忆允许想不起来、余震真的会发生、主动开口有了预算。
三条都是设计层先定稿、插件层落后一代的部分。

**记忆召回 v2（`memoryCurve: v2`，可回退到 `v1`）**

- 改了什么：召回从「有分就取前 k 条」换成「激活度 + 确定性抽样」——
  `1.1·ln(保持+0.02) + 0.9·线索 + 0.5·重要度 + 心情染色(±0.45) + 0.4·Gumbel(hash)`；
  线索低于 `minCue` 先淘汰；最低分 `floor` 以下不进池；最多 6 条，不足不补位，**允许 0 条**。
- 为什么：v1 的读数是「平均 5.97 条、相关度 0.05、一条被注入 134 次」。
  一定是「有记忆」而不是「想起了什么」——记忆变成了背景板。
- 配套：`stability` 稳定度（初值 `1.5 + 6×重要度`，时刻/承诺 ×1.3）、
  「被想起会变牢」（`S' = S × (1+1.2(1−r))`，间隔效应）、六类记忆、单条 ≤ 80 字、
  500 条容量、淘汰记录、`serene_reinforce`。
  噪声来自 `hash(id, 查询, 时间戳)`，不用 `Math.random`，可复算可测试。
- 怎么确认在起作用（观察窗两周）：
  - **0 召回率**：应从 0% 升到 30–40%。长期为 0 → `minCue` / `floor` 太松；
  - **单条占比**：任何一条记忆被注入的次数不应超过召回总量的 20%；
  - **相关度**：抽 20 次召回，看「真的相关」的条数占比，应从 0.05 的级别往上走。
  - 判定：0 召回率 < 10% 或单条占比 > 40%，调 `minCue` / `floor`，不动公式。

**余震（`emotion.json` 新增 `residue`）**

- 改了什么：`advance()` 一直收 `residue`，但 store 从没传过——高冲击事件后的
  24–48 小时尾巴从来没发生过。现在 |Δ愉悦| ≥ 8 的事件会写一条余震并随状态落盘，
  半衰期按冲击大小取 24–48 小时。
- 为什么：一次争吵过去六小时，初级层已经回落，但「今天不对劲」还在。
  没有余震，她第二天早上会像什么都没发生。
- 怎么确认：`serene_state` 的 `residue` 非空；余震过了 48 小时，底色应回到原轨迹
  （不是靠 reset，是自己走回去）。

**主动预算与 hold（`motivation.json`）**

- 改了什么：新增 `core/motivation.js` + `MotivationStore` + 两个工具。
  `serene_proactive` 回答「这次该不该开口」：意图、预算（3 次/天、间隔 60 分钟）、
  20 分钟线性回收的 hold、以及不说时的替代动作。
  `serene_proactive_done` 记一次开口；被拒时同时记 `rejection` 事件并冷却 30 分钟。
- 为什么：以前只有 `proactiveGap`（12–75 分钟），它回答「大概多久」，
  不回答「现在可不可以」。门越多她越安静，安静久了「不说」会自增成习惯。
- 怎么确认：连续 20 次决策里，`act` 不应全是 false；`hold` 的 `expiresAt` 不能被延长；
  被拒之后再问，应该返回 `cooldown` 而不是继续凑上去。

**兼容**

- 旧数据不用迁移：`emotion.json` 读到 version 1 就补一个空 `residue`；
  `memories.jsonl` 里没有 `stability` 的记忆按写入公式现算；没有 `type` 的行仍按记忆读。
- `serene_remember` 现在拒绝超过 80 字的内容（提示重写，不静默截断）；
  `serene_recall` 的输出多了类型和 id，`serene_state` 多了 `residue` 与 `proactive`。
- 配置新增 `memoryCurve` / `memoryCapacity` / `proactivePerDay` / `proactiveGapMinutes`。

**测试**

- 55 个：新增激活度/0 召回/不补位/确定性/心情染色/强化、容量与淘汰、余震落盘与作用、
  预算/hold/反棘轮/跨天清零。

## 0.1.1 — 2026-10-24

一次「装好了到底有没有生效」的修复。行为不变，失败不再无声。

**新增**
- `serene_status`：确认插件是否真的挂载（人格 / 数据目录 / 记忆条数）。
  人格加载失败时它是唯一还注册的工具，直接返回失败原因和修法。
- 人格 / 工具注册失败时同时写一行 stderr，headless 和后台启动也能看见，不再只走 logger。

**文档**
- README / README.en.md 增加「第一次运行：凭据与自检」：新 profile 不继承凭据，
  第一句话会报 `MISSING_CREDENTIAL`；给 dump-config 和 `serene_status` 两步确认。
- 工具表、源码清单、测试数量同步到 7 个工具 / 28 个用例。

**测试**
- 28 个：新增 `serene_status` 正常态断言；失败用例改为断言「只剩诊断工具 + stderr 有输出」。

## 0.1.0 — 2026-10-24

第一个可安装的版本。只做三件事：人格、情绪、记忆。

**新增**
- `core/emotion.js`：PAD+ 六维 × 三层，衰减 / 昼夜节律 / 事件增量 / 享乐适应 /
  疤（基线位移）/ 情绪改判 / 自然语言描述，全部纯函数。
- `core/recall.js`：中英混排分词、时间衰减、相关度 × 重要度打分。
- `EmotionStore`：原子落盘、打开时补算离线时段、同种负面事件敏感度累加。
- `MemoryStore`：jsonl 追加写、按话题召回。
- 6 个工具：`serene_context` / `serene_mood` / `serene_event` / `serene_remember` /
  `serene_recall` / `serene_state`。
- 人格档案改为 JSON（`personas/demo.json`），称呼词表可配置。
- 27 个测试：确定性、衰减方向、疤的封顶、改判、落盘、插件挂载。

**刻意没有做**
- 没有守护进程、没有心跳、没有屏幕采集、没有图像生成——纯插件，随 agent 调用前进。
- 没有向量检索，召回是可解释的词面 + 衰减；换更强的实现只需保持 `rank()` 形状。
- 没有 UI。想看状态就调 `serene_state`。

**已知限制**
- 记忆是全量加载，几千条以内没问题；再大需要换存储。
- 人格只有中文示例；英文人格能跑，但描述文案是中文。
