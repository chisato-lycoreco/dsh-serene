# Changelog

## 未发布

- 新增 `serene_status`：确认插件是否真的挂载（人格 / 数据目录 / 记忆条数）。
  人格加载失败时它是唯一还注册的工具，直接返回失败原因和修法——不再是一装就静默消失。
- 人格 / 工具注册失败时同时写一行 stderr，headless 和后台启动也能看见，不再只走 logger。
- README / README.en.md 增加「第一次运行：凭据与自检」：新 profile 不继承凭据，
  第一次运行会报 `MISSING_CREDENTIAL`；给最小验证命令和三层确认表。
- README / README.en.md 的安装段落改成 npm 优先。
- 这个文件会随下一版一起发出去。

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
