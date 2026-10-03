---
document_type: research
status: verified-with-limitations
last_updated: 2026-10-03
---

# 运行中 Context 缺失复核

基线 `79d471de`，修复分支 `rovai/runtime-live-context`。本轮只修 Claude 占用发出时机，
同时审计其余 Runtime 的窗口条件、采样时机和共享持久化栅栏；不重新承诺全字段支持。
当前合同见 [Execution Metrics v6](../../contracts/runtime-execution-metrics-v6.md)。

## Claude 现场与根因

用户报告 Thread `rvcamp_01m40ydj03ee1ahky5fj6f8g8f` 的 Claude 上下文缺失。
只读检查时 Run `8f1c1467-9fad-4827-85ee-c9b13dd1027f` 仍在 running，原生调用用量持续落盘，
当前 Session 没有 Context 行。Claude Code 2.1.280，配置模型别名 opus，实际原生模型 gpt-6.1-sol，
使用本机 sub2api 配置。原生根调用在 2026-10-03T13:38:21Z 记录输入 115268、缓存读 0、
缓存写 0、输出 1329；上一调用还观察到输入 2185、缓存读 110080。这里只提取数字和身份，
没有复制正文、思考、工具参数或凭据。

`claude.rs::normalize_claude_runtime_events` 已逐调用接收数值，但旧实现仅在整轮 result
与匹配原生模型的 contextWindow 同时到达时才发 Context。故这是 `present_not_mapped`，
不能根据读回为空宣称 Runtime 没有占用。原生 transcript 未包含结构化窗口，不代表所有 wire
通知都没有窗口；不能将其他历史样本的 200000 套到该 Run。

修复后，完整有效输入三桶在根 message_delta 到达时就形成 used-only Gauge；匹配 result
到达后再提供窗口，字段缺失、子调用、起始暂定零、跨 Session、跨模型不补值。

## 其他 Runtime 审计

以下是当前代码的**采样/持久化时机审计**，不是逐 Runtime 新一轮健康调用的结论。
除下面单列的真实验收外，既有字段证据仍以各次历史记录为准。

| Runtime | 当前 Context 来源 | 同类风险或边界 |
| --- | --- | --- |
| Claude Code | 根调用三输入桶；result 原生模型窗口 | 本轮修复：不再等待整轮 result，也不因窗口未知丢弃 used |
| Codex | tokenUsage.last.totalTokens / modelContextWindow | 通知逐次处理，used/window 独立可缺；没有 Claude 的整轮 result 门槛 |
| OpenCode | 完成的根 assistant 调用；ACP usage_update 的 size | native reader 在现有周期 Flush 读取，支持 used-only；受下面 ACP 确认栅栏限制 |
| CodeBuddy | 当前已确认模型的最新根调用 inputTokens / maxInputTokens | 支持窗口未知、used 独立；仍需当前模型身份匹配及 ACP 确认 |
| Qwen Code | ACP usage_update.used/size | parser 不要求整轮 result 或两字段齐全；受 ACP 确认限制 |
| Pi | 原生 ctx.getContextUsage()，turn_end / session_compact | 按模型回合/压缩取样；原生 API 的 contextWindow 必须有效，可仅有窗口。不是逐 token 占用 |
| ZCode | 终态 session/read 的 runtime.contextUsage.used/size | **仍只在 prompt 收口读取**，运行中/压缩后及时刷新未验证；目前严格要求原生数量对 |
| DeepSeek Harness | ACP usage_update used/size Gauge | 已有 Gauge parser，无整轮 result 条件；受 ACP 确认限制 |
| Qoder | 根原生 message 的 context_usage_ratio，可验证时补数量 | 比例独立保留；支持数量未知。周期本地读取仍受 ACP 确认限制 |
| Kimi Code | ACP usage_update，包括短期 owner 下迟到 Gauge | used/size 独立；受 ACP 确认限制，晚到值不得串到新 Session |
| Grok Build | 根通知 params._meta.totalTokens；匹配模型显式窗口 | used 无需窗口，按通知处理；受 ACP 确认限制 |
| Antigravity | 当前已完成根模型步骤的 gen_metadata Context | 不是整轮终态才读取，但目前需要完整原生 used/window；缺窗口形态没有新的健康样本 |
| Kiro | _kiro.dev/metadata.contextUsagePercentage；匹配 Session 原生窗口 | 比例独立，精确 used 仍未知；受 ACP 确认限制，不能反推 token 数 |
| TRAE CLI CN | 最新根调用 prompt_tokens 与当前 source_model 有效窗口 | 支持 used-only、窗口未知；本地周期读取仍受 ACP 确认限制 |
| Copilot CLI | ACP Context Gauge；assistant.usage 仅计 Run 用量 | Gauge parser 已接；受 ACP 确认限制，不把累计输入冒充占用 |
| Cursor Agent | 不在本轮范围 | 按用户要求排除 |

### ACP 的共性时机限制

`acp.rs::route_session_message` 对常规活动只记录 prompt_activity_observed；除 ZCode 的原生
inputAccepted 外，`complete_pending` 在匹配 prompt 返回时才发 InputAccepted。
`monitoring.rs::context_waits_for_input` 因此保留当前 Run 最新一个纯数值 Gauge，
`persist_session_context` 等 delivery accepted 后才落盘。已映射但等待此栅栏属于
`mapped_not_projected`，不能写成 raw_absent。已有 Session 的旧观测可能仍显示，但不是本轮新占用。

这同时牵涉 rejected input、恢复重发、迟到旧 owner 与 Session 身份，不能通过取消数据库
accepted 条件来补界面。本轮保持 [既有输入确认合同](../../contracts/runtime-execution-metrics-v3.md)
边界，并明确这一限制；没有把全部 ACP Runtime 宣布为实时 Context 已验收。

源码定位：`claude.rs::claude_context_observation`；`monitoring.rs::parse_codex_usage_message`、
`parse_acp_usage_message`、`context_waits_for_input`、`persist_session_context`；
`native_usage.rs` 的 OpenCode / codebuddy_context / trae_context / Qoder reader；
`pi/managed-host.ts::publishContextUsage`；`zcode/transport.rs::native_context_update`；
`antigravity/native_metrics.rs::read_context`。所有路径仍复用当前绑定/代次栅栏。

## 自动化与真实 App 验收

既有 Claude stream owner 扩展 result 前 Gauge、零/缺失、子调用及模型匹配；既有 Session
持久化 owner 扩展 used-only 读回和原生计量隔离。测试归属与重放入口见
[测试说明](../../development/testing.md#原生-usagecontext-测试准入2026-09-30)。

真实打包 App 验收使用 `native-live-context-task.txt`，在工具停顿期间读取 Context 并核对
Renderer 气泡；Run 终态的数据不能代替运行中证据。本轮成功证据如下：

- App 0.4.3 / macOS arm64，打包 Core SHA-256 `fbb5426ea181c25df5cf5ca7b72aa19906929ebfbd38e8174e4039a0ef12722e`。
- Claude Code 2.1.280，沿用本机 sub2api 配置，选择 opus，原生日志 model 为 gpt-6.1-sol。
  当前 Context 投影的 modelKey 仍是配置/Run 的 opus；原生数量与窗口配对使用 message 中的实际 model ID，二者不混称。
- 新 Thread `rvcamp_01m4137knffs8bp8htqk1dr72k`，Run `c60030c7-4d21-4a85-aa86-6a3cc055e495`；
  运行时间 14:38:32–14:40:47 UTC，终态 succeeded。使用独立 userData、Skill Library、MCP 文件和工作区。
- 运行中共读到 6 个不同最新占用：11148、11437、11556、11676、11904、12608。
  首个持久化观测在采样第 6 秒出现；第 8 秒气泡核对 `11.1k / —`、比例 `—`，Run 仍在 running。
- 终态观测 used=12791、window=200000；Renderer `12.8k / 200k，6.4%`。
- 原生日志 15 条数值记录归属 7 个独立 message；去重求和 Input=83120、Output=1421、Cache Read=28928、Cache Write=0，
  与 Run 读回及气泡一致，inputOutputComplete=true。Context 是最后一次调用 12791，不是累计 83120。
- [脱敏 fixture](fixtures/claude-live-context-2026-10-03.json) 保留原生 assistant.message.usage 数字、期望单调用占用、
  运行中/终态投影与 Renderer 对照。新 fixture 未捕获 raw stdout 的 result 帧，窗口证据来自实际 result 路径的读回与界面；
  原始 result 方言仍由已有 round5 fixture 回归。本轮没有将重建的 stream envelope 冒充原始 wire。

本机完整截图和范围查询报告保留在 `RovaiMetricsAcceptance/live-context-20261003T142538Z/captures-5/`；
独立数据库在同根 `fixture-5/user-data/`。验收脚本已退出它启动的 App/Core；日常实例未被更改。

前置验收还修正了脚本滞后的 Manifest/Run Facts 版本（32/9）、Thread Sidebar target、
桌面 IPC 方法名和创建回执 Thread ID。这些属于 fixture/脚本，没有变更生产模型提示。
前四次入口调试不计入健康验收；其中一次刚派发的 Run 随隔离 App 清理而 cancelled。

自动化结果：Claude 33 项、monitoring 13 项、修改后的 Session 持久化 owner、ACP 输入确认 owner 均通过；
默认 Rust workspace 450 项通过、1 项既有人工作业忽略；格式和通用文档门禁通过。

## 未决范围

- ACP 输入确认前 Context 只缓冲、ZCode 只取终态快照仍是明确时机限制。本轮没有逐一重跑这些 Runtime，不能宣称其运行中显示已修复。
- Pi/Antigravity 的原生来源要求有效窗口；缺窗口仅有 used 的健康样本仍未取得。Kiro 精确 used 依然未知。
- 真实取消、崩溃、压缩、改模型后的实时 Context 未在此 App 用例中重跑；既有身份/晚到/部分字段回归保持通过。
- 本次未回填用户旧 Run；部署新 Core 后的新观测才执行这条修复路径。
