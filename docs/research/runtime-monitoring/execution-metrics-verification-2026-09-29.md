---
title: "执行指标第二轮字段级核验"
status: "implementation-evidence"
reviewed_at: "2026-09-29"
target_version: "v1.72"
---

# 执行指标第二轮字段级核验

本记录续接[第一轮记录](execution-metrics-verification-2026-09-28.md)。所有真实调用使用隔离 Core 数据目录与 Runtime 配置。`tok/s` 是公开正文显示估算，不是 Usage。表中“可用”只适用于注明的安装版本、Provider、模型和场景；原生明确零写为 `0`，原始字段未见或未查到不写为零。脱敏的原始数值、parser 预期和数据库读回见[第二轮字段 fixture](fixtures/round2-sub2api-field-evidence.json)。

## 16 类 Runtime 矩阵

| Runtime／本轮模型和启动方式 | Input | Output | Cache Read | Cache Write | Session used／window | 当前 tok/s | 字段级来源与到达时机 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex CLI 0.157.1；sub2api/gpt-6-sol，App Server | 可用 | 可用 | 可用 | 可用，原生 0 | 可用，22249／258400 | 条件可用，公开正文增量 | `thread/tokenUsage/updated` 的 `total` 进入 Run summary，`last.totalTokens` 与同帧 `modelContextWindow` 进入 Session；同一 Native Session 两 Run、SQLite 读回；[fixture](fixtures/round2-sub2api-field-evidence.json)。 |
| Claude Code 2.1.274；gpt-6-sol，原 Provider 未公开 | 可用 | 可用 | 可用 | 可用，原生 0 | 未验证，缺 `message_start/message_delta/modelUsage` 对照 | 条件可用，11 次正文增量 | 终态 `result.usage` 四项读回；[第一轮 fixture](fixtures/claude-2.1.274-execution-metrics.json)。上下文原始通知未保留。 |
| GitHub Copilot CLI 1.0.83；claude-sonnet-5 | 本轮忽略 | 本轮忽略 | 本轮忽略 | 本轮忽略 | 本轮忽略 | 本轮忽略 | 用户要求先忽略；第一轮配额不足，不作为健康回合。 |
| OpenCode 1.18.30；sub2api/gpt-6-sol，ACP | 可用 | 可用 | 可用，仅原生 0 | 可用，仅原生 0 | 未验证，需原始 `usage_update.used/size` | 条件可用，9 次正文增量 | 终态四项读回；[第一轮 fixture](fixtures/opencode-1.18.30-execution-metrics.json)。正值缓存、多工具归并和 Gauge 原始帧待测。 |
| CodeBuddy 2.133.1；sub2api/custom-local:gpt-6-sol，ACP | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 条件可用，10 次正文增量 | 原生 CLI JSON 有 Usage；健康 ACP 提示 `end_turn` 却无 Usage 通知，四项与 Context 读回均空。Core 已修复自定义模型目录准入；ACP 用量仍是 `raw_absent` 的本次短回合观察。 |
| Qwen Code 0.24.5；gpt-5.6-sol(openai)，ACP | 可用 | 可用 | 可用，仅原生 0 | 未验证，缺原始写入语义 | 可用，18775／272000 | 条件可用，9 次正文增量 | 终态 Usage 与 `usage_update` Gauge 分离；[第一轮 fixture](fixtures/qwen-0.24.5-execution-metrics.json)。压缩、恢复、子 Agent 排除待测。 |
| Pi 0.84.4；sub2api/gpt-5.6-sol，RPC | 可用 | 可用 | 可用 | 可用，仅原生 0 | 未验证，需原生占用来源 | 条件可用，8 次正文增量 | 原生 Run 用量读回；[第一轮 fixture](fixtures/pi-0.84.4-execution-metrics.json)。模型上限不能单独当占用。 |
| ZCode 0.16.9；runtime-default，Provider 未公开 | 可用 | 可用 | 可用，仅原生 0 | 未验证，缺原始字段 | 未验证，需完整私有 Context 帧 | 条件可用，仅两次增量，不足以验稳定速度 | 私有 Usage 扩展在终态前入库；[第一轮 fixture](fixtures/zcode-0.16.9-execution-metrics.json)。 |
| DeepSeek Harness 0.1.5-rc.3；sub2api/gpt-6-sol，ACP | 条件可用：本次原生分类不全，读回 `null` | 可用，24 | 已测未上报 | 已测未上报 | 条件可用，11410／262144，窗口配置待核 | 未验证：仅一次可见增量 | 原生 `assistant/message.usage` 有 `inputTokens=11386`、`outputTokens=24`，无缓存分类；Input 按互斥桶语义保持 `null`，属于 `mapped_not_projected`。Gauge 入库，但 262144 是否为 Provider 有效上限未独立确认。 |
| Qoder 1.1.28；sub2api 目标 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 安装版自定义模型只可通过官方交互 `/model` Custom 配置；未取得账户交互配置，未做健康 sub2api 调用。第一轮默认服务余额不足。 |
| Cursor Agent 2025.09.18-7ae6800 | 不支持本轮 | 不支持本轮 | 不支持本轮 | 不支持本轮 | 不支持本轮 | 不支持本轮 | 用户明确要求不支持；不绕过平台资格检查。 |
| Kimi Code 2.1.1；sub2api/gpt-6-sol，ACP | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 可用，20765／262144 | 条件可用，9 次正文增量 | 健康 ACP 回合没有四桶 Usage；提示结束后 `session/update usage_update` 带 `used/size`，原 Core 丢弃，现按旧 Session owner 与代次短暂保留并入库读回。直接原始 Gauge 样本与 Core 回合为不同调用。 |
| Grok Build 1.0.41；sub2api/gpt-6-sol，Responses ACP | 可用，17755 | 可用，69 | 可用，原生 0 | 可用，原生 0 | 未验证，未见占用帧 | 条件可用，9 次正文增量 | `_x.ai/session_notification turn_completed.usage` 四项终态入库；`response_completed` 同批消耗不重加；同次原生 session log 与 SQLite 值一致。正值缓存与多模型调用仍待测。 |
| Antigravity 1.2.12；runtime-default，Provider 未公开 | 未验证，原始帧缺失 | 未验证 | 未验证 | 未验证 | 未验证 | 无当前速度：只有整段终稿 | 成功 Run 读回为空，未保存足以判断 `raw_absent` 的原始通知；[第一轮 fixture](fixtures/antigravity-1.2.12-execution-metrics.json)。 |
| Kiro 2.21.1；runtime-default，Provider 未公开 | 未验证，原始帧缺失 | 未验证 | 未验证 | 未验证 | 未验证 | 条件可用，仅两次正文增量 | 成功 Run 读回为空；需脱敏原始通知以区分上游缺失与适配过滤。 |
| TRAE CLI CN 0.120.52；runtime-default，Provider 未公开 | 未验证，原始帧缺失 | 未验证 | 未验证 | 未验证 | 未验证 | 无当前速度：仅一次整段正文 | 成功 Run 读回为空；需原始流和终态字段。 |

## 字段归因与链路状态

使用 `verified_available`、`raw_absent`、`present_not_mapped`、`mapped_not_projected`、`blocked_unverified` 区分**字段与本次样本**，不能用空读回替代原始帧审查。Codex `last.totalTokens` 原先是 `present_not_mapped`，现为 `verified_available`；Run Usage 的累计来源身份与 Context 来源身份已分离，总量不变而 `last` 改变、Context used 下降的 parser 测试可通过。Kimi `usage_update` 原先是 `present_not_mapped`，现为 `verified_available`；迟到 Gauge 在 Run 已终止后仍能入库。Grok 四项原先是 `present_not_mapped`，现为 `verified_available`。DSH `inputTokens` 原始存在且已归一化，但缺 Cache Read/Write 时 Input 总量仍为 `mapped_not_projected`；Output 与 Context Gauge 已读回。CodeBuddy 本次 ACP 短回合是 `raw_absent`，不能推广到原生 CLI JSON 模式。Qoder 与被忽略的 Copilot 属 `blocked_unverified`；未保留原始帧的旧健康样本也维持“未验证”，不误写为 `raw_absent`。Cursor 按用户要求排除。

## 显示估算与检验

`visible-text-heuristic-v2` 用 ASCII 0.25、Han 0.60、其他 Unicode 标量 1.00；这是显示策略，不是通用 tokenizer。英文四字符一 token 是 [OpenAI 粗估](https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens)与 [Google 文档](https://ai.google.dev/gemini-api/docs/tokens)共有的经验基线；中文 0.60 来自 [DeepSeek 用量说明](https://api-docs.deepseek.com/quick_start/token_usage/)。代码、标点、空白与其他 Unicode 权重是工程兜底，未按模型校准。测试覆盖英语、中文、混合、代码、JSON、Markdown、空白、emoji、Han 扩展字符、重复和重叠 offset、UTF-16 代理对跨事件、重连基线、长时间等待与 idle 后再输出。样本按相同可见正文对比，未拿含隐藏推理的原生 Output 校准速度。

内部 500 ms 采样、2.5 s 平滑、有效输出后预热 1 s、最多每秒更新一次、5 s idle 后隐藏。当前速度位于队员名称行与上下文圆环之间，Running 卡片仅保留原有耗时；终态卡片有用量时只显示 `xxk`，气泡底部提供耗时。`execution-token-speed.test.ts` 使用 30 秒固定事件回放，断言恰好 30 次发布、工具静默清空与恢复后重新预热。`ROVAI_RUNTIME_ACTIVITY_ACCEPT_METRICS_ONLY=1 pnpm accept:runtime-activity-ui` 在隔离打包版 App 上通过：无流式正文时标题行隐藏速度，运行卡片在 77 px 尾部槽内显示 `1分 24秒`；终态卡片仅显示 `2k`，气泡显示四桶 `1.5k / 0.5k / 0.3k / 0k` 及 `1分 29秒` 耗时。

第二组 `ROVAI_RUNTIME_ACTIVITY_ACCEPT_METRICS_STREAM_ONLY=1 pnpm accept:runtime-activity-ui` 使用[受控 ACP 流夹具](../../../scripts/fixtures/streaming-acp-runtime.mjs)，经隔离 Core 的真实 Run 送入打包 App；该夹具临时冒充 Qwen 可执行文件，**不是 Qwen Provider 能力证明**。运行记录见[Renderer 动态验收 fixture](fixtures/round2-stream-renderer-acceptance.json)：持续正文在队员标题行显示当前速度，卡片保留耗时；切到另一 Camp 后重开该队员详情，以已有正文建立隐藏基线，新增正文后才显示速度；展开同 Agent 的历史 Run 卡时，标题行仍只显示当前 Run 的速度；工具停顿后速度隐藏，恢复输出后重新显示，终态立即移除。实际数值发布间隔至少约 1000 ms。终态先到、随后在隔离数据库写入用量的竞争场景里，卡片先显示时钟入口；App 未重启，终态轮询把入口刷新成 `2k`，气泡显示四项与耗时。脚本生成持续、停顿、恢复、迟到用量四张截图。迟到用量采用受控数据库更新验证读回与 Renderer 轮询，**不代表已取得该 Runtime 的迟到原生 Usage 回包**。

## 未决事项

1. **模型与账户**：Qoder 需要[官方 `/model` Custom 交互配置](https://docs.qoder.com/cli/custom-models)与相应账户资格；Copilot 按本轮指令忽略。CodeBuddy ACP 未发用量，需核对该版本 ACP 方言或切换到保留会话能力的官方结构化入口，不能从非 ACP JSON 结果冒充 ACP 数据。
2. **Session**：Codex 已实测同一原生 Session 两 Run 的 used 更新，仍缺真实压缩、模型切换、Core 重启后的同会话 Context 连续性。Kimi、Qwen 需真实压缩／恢复／重放和子 Agent 排除；Claude 需当前模型的 `modelUsage.contextWindow` 与最近调用对照；Pi、OpenCode、ZCode 与 Grok 需实际占用帧。
3. **Usage 边界**：Grok 需多工具、多模型调用、重复终态与正值缓存；DSH 需 Provider 明确完整的互斥输入分类与有效窗口证明。失败、取消、超时、恢复基线、计数重置、并发和会话换代已由现有通用测试覆盖部分路径，尚缺逐 Runtime 的原生回包。
4. **Renderer 与迟到结算**：隔离打包 App 已通过受控 ACP 固定流的持续输出、工具停顿、恢复、中途打开、历史 Run 卡和终态，以及终态后数据库补写 Usage 的 10 秒轮询；仍需真实 Runtime 的迟到原生 Usage 帧，验证它能按各自方言进入数据库，而不是仅验证已经落盘后的读取。

实现合同：[Runtime Execution Metrics v1](../../contracts/runtime-execution-metrics-v1.md)。
