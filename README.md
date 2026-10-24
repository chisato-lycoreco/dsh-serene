# dsh-serene

> 把「一个会记得你的角色」接进 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/)。
> 人格是数据，情绪是状态，记忆是文件——三者都可读、可改、可复现。

大多数「角色卡」是一段写在 system prompt 里的描述：模型每次都从零开始扮演，聊得越久越不像。
这个插件换一种做法：**把角色拆成可计算的状态**，让「她此刻怎么样」由时间、事件和历史决定，
而不是每次重新即兴。

- 情绪：PAD+ 六维 × 三层（底色 / 此刻 / 关系），会衰减、有昼夜节律、会留疤；
- 记忆：jsonl 落盘，按相关度 + 时间衰减 + 重要度召回，公式可复算；
- 人格：一份 JSON，换人格不用改代码。

它是 [`FRAMEWORK.md`](./FRAMEWORK.md) 里那套七层结构的最小参考实现——**只有织法，没有布**：
不包含任何私人角色、私人记忆、屏幕采集或图像生成。

---

## 它做什么 / 不做什么

| 做 | 不做 |
| --- | --- |
| 记录事件、推进情绪、把状态讲成人话 | 不替模型写回复，不改写对话内容 |
| 长期记忆的写入与召回 | 不自己调模型、不自己总结 |
| 人格档案的读取与拼装 | 不读 `.env`、凭证、聊天记录原文 |
| 状态落盘（原子写）、可手改可进 git | 不联网、不上报、不采集屏幕 |

---

## 安装

要求：DSH `>= 0.2.1-rc.2`，Node `>= 22.19`。

```bash
# 从本地目录装（开发时）
dsh plugin --profile web add "/absolute/path/to/dsh-serene"

# 从 GitHub 装（发布后）
dsh plugin --profile web add "github:Something11235/dsh-serene#v0.1.0"

# 从 tgz 装（Release 里下载）
dsh plugin --profile web add ./dsh-serene-0.1.0.tgz
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

---

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `persona` | `demo` | `personas/` 下的文件名，或绝对路径 |
| `personaRoot` | 插件自带 `personas/` | 人格档案目录 |
| `dataDir` | `$DSH_HOME/plugins/dsh-serene` | 状态与记忆落盘位置 |
| `recallLimit` | `5` | 每次召回默认条数 |
| `halfLifeDays` | `45` | 记忆时间衰减半衰期 |

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
| `serene_event` | 记一件事进情感层（30 种事件，见下） |
| `serene_remember` | 写一条长期记忆 |
| `serene_recall` | 按话题召回记忆，带时间和分数 |
| `serene_state` | 调试用：三层数值、最近事件、疤 |

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
  "version": 1,
  "updatedAt": 1761288000000,
  "lastInteractionAt": 1761287900000,
  "layers": {
    "background": { "pleasure": 63.1, "arousal": 43.8, "dominance": 59.9, "curiosity": 57.4, "confidence": 61.6, "connection": 60.4 },
    "primary":    { "pleasure": 68.2, "arousal": 47.1, "dominance": 60.3, "curiosity": 58.0, "confidence": 62.1, "connection": 61.9 },
    "social":     { "pleasure": 61.4, "arousal": 43.0, "dominance": 59.5, "curiosity": 57.8, "confidence": 61.2, "connection": 61.1 }
  },
  "wounds": [],
  "history": [{ "kind": "affection", "at": 1761287900000, "intensity": 1 }]
}
```

`memories.jsonl`：一行一条，直接 `grep` 就能找。

两个文件都是你的：可以备份、可以手改、可以删。删掉就是从没发生过。

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
2. **情绪只影响语气，不改写事实。** 状态进 prompt 的是一段人话（「这会儿有点低，别硬撑」），
   不是「你现在很生气」，更不会篡改检索到的记忆。
3. **一切可复现。** 同样的初始状态 + 同样的事件 + 同样的时间戳，永远得到同样的结果；
   没有随机数、没有模型调用。测试里跑的就是这一点。

更完整的结构说明见 [`FRAMEWORK.md`](./FRAMEWORK.md)。

---

## 开发

```bash
npm install          # 只装 devDependencies（schemastery / dsh-tools）
npm test             # node --test，27 个用例
```

```
core/emotion.js           纯函数：衰减、节律、事件、疤、描述
core/recall.js            纯函数：分词、衰减、召回打分
src/stores/emotion-store.js   唯一碰磁盘的地方（原子写）
src/stores/memory-store.js    jsonl 追加与召回
src/persona.js            人格档案 → prompt 段
src/tools.js              6 个工具
src/index.js              name / inject / Config / apply
```

`core/` 里没有 `fs`、没有 `Date.now()`、没有网络。想验证：

```bash
grep -n "node:fs\|process.env\|fetch(" core/*.js   # 应该没有输出
```

---

## 与其它插件的关系

- **灵枢（`@furongjun1999/dsh-memory`）**：那是「工作记忆」，记的是任务和事实。
  这个插件记的是「关系」，两者不要合并——工作记忆要准，关系记忆本来就会褪色。
- **dsh-dafeiyu**：桌宠形态的前端。这个插件是纯后端，没有 UI；想接桌宠，
  读 `serene_state` 的返回值自己画即可。

---

## License

代码 MIT。人格档案（`personas/`）随你改成什么样都行，改完是你的人格，不是我的。
