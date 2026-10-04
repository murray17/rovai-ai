---
title: "执行指标逐 Runtime 核验记录"
status: "implementation-evidence"
reviewed_at: "2026-09-28"
target_version: "v1.72"
---

# 执行指标逐 Runtime 核验记录

此为第一轮当日记录；[第二轮字段级核验](execution-metrics-verification-2026-09-29.md)记录后续配置、修复与读回，状态有冲突时以后者为准。

本记录以 2026-09-28 当前分支、隔离 Core 数据目录、实际安装的 Runtime 和真实短回合为准。清单原有的 parser 准入只是核验起点。这里的“可用”只表示**表内注明的版本与调用条件**通过原生事件、归一化、Run/Session 归属、SQLite 保存以及 `monitoring.execution` 读回；不推广到同 Runtime 的所有模型、Provider 和状态。脱敏投影放在 [`fixtures/`](fixtures/)；本地原始日志和数据库没有提交，避免带入账户、会话和工作区标识。

状态：**可用**＝该版本本次真实调用取得且读回；**条件可用**＝只取得部分字段或满足流式条件时可测；**已测未上报**＝成功调用完成但该字段保持 `null`；**未验证**＝被配置、配额、Runtime 错误或缺少探针阻断。明确上报的 `0` 与 `null` 分开记录。`tok/s` 是独立的 Renderer 估算，表中的“条件可用”仅说明公开正文增量到达；本轮未拍摄实际 Renderer 速度读数。

| Runtime／实际版本；模型或 Provider | Input | Output | Cache Read | Cache Write | Session Context used／上限 | 当前 tok/s | 来源、到达时机与证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex CLI 0.157.1；gpt-6-sol，Provider 未公开 | 可用 | 可用 | 可用 | 可用，原生 0 | 条件可用：仅窗口 258400，used 未验证 | 条件可用：正文增量 | `token_count` 运行事件在终态前进入 summary；两个 Run 的读回及 Core 重启读回见 [fixture](fixtures/codex-0.157.1-execution-metrics.json)。两轮原生 Session 延续未通过旧 smoke 断言。 |
| Claude Code 2.1.274；gpt-6-sol，Provider 未公开 | 可用 | 可用 | 可用 | 可用，原生 0 | 已测未上报 | 条件可用：11 次正文增量 | `result` 原生 Usage，终态归一化并读回，见 [fixture](fixtures/claude-2.1.274-execution-metrics.json)。 |
| GitHub Copilot CLI 1.0.83；claude-sonnet-5 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | Ready 后运行返回月配额不足文本，无可信消耗观测；见 [阻断记录](fixtures/blocked-probes-2026-09-28.json)。不得把它的成功状态当成功用量。 |
| OpenCode 1.18.30；sub2api/gpt-6-sol | 可用 | 可用 | 可用，原生 0 | 可用，原生 0 | 已测未上报 | 条件可用：9 次正文增量 | ACP 终态 Usage，结束后读回，见 [fixture](fixtures/opencode-1.18.30-execution-metrics.json)。 |
| CodeBuddy 2.133.1；无可用默认模型 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 安装探针因缺少默认模型失败，没有真实回合；见[阻断记录](fixtures/blocked-probes-2026-09-28.json)。 |
| Qwen Code 0.24.5；gpt-5.6-sol(openai) | 可用 | 可用 | 可用，原生 0 | 已测未上报 | 可用：18775／272000 | 条件可用：9 次正文增量 | ACP 终态 Usage 和独立 `usage_update` Context Gauge，结束后读回，见 [fixture](fixtures/qwen-0.24.5-execution-metrics.json)。Context 的 used 来自原生 Gauge，不从累计 Usage 推断。 |
| Pi 0.84.4；sub2api/gpt-5.6-sol | 可用 | 可用 | 可用 | 可用，原生 0 | 已测未上报 | 条件可用：8 次正文增量 | Pi 原生运行报告；隔离配置的一轮执行后读回，见 [fixture](fixtures/pi-0.84.4-execution-metrics.json)。 |
| ZCode 0.16.9；runtime-default，Provider 未公开 | 可用 | 可用 | 可用，原生 0 | 已测未上报 | 已测未上报 | 条件可用：2 次正文增量 | Runtime 私有 Usage 扩展在终态前写入并读回，见 [fixture](fixtures/zcode-0.16.9-execution-metrics.json)。 |
| DeepSeek Harness 0.1.5-rc.3；deepseek-official 默认路由 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证，parser 有 Gauge 基础 | 未验证 | Ready 后真实调用需 `DEEPSEEK_API_KEY`，见[阻断记录](fixtures/blocked-probes-2026-09-28.json)；不能把 parser Gauge 当展示链路已验。 |
| Qoder 1.1.28；minimax/minimax-m3-cp | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | Ready 后自定义模型服务余额不足，回合失败；见[阻断记录](fixtures/blocked-probes-2026-09-28.json)。 |
| Cursor Agent 2025.09.18-7ae6800；模型未定 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | `runtime.product.check` 以 macOS 平台资格证据缺失拒绝，未启动回合；见[阻断记录](fixtures/blocked-probes-2026-09-28.json)。 |
| Kimi Code 2.1.1；环境默认模型 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | Ready 后回合 `end_turn` 却没有必需最终输出，失败前未收到指标；见[阻断记录](fixtures/blocked-probes-2026-09-28.json)。 |
| Grok Build 1.0.41；minimax-m3 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | 未验证 | Ready 后提示阶段内部错误，未形成有效用量；见[阻断记录](fixtures/blocked-probes-2026-09-28.json)。 |
| Antigravity 1.2.12；runtime-default，Provider 未公开 | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报：仅整段终稿 | 成功回合的 Core 终态读回；正文增量计数为 0，见 [fixture](fixtures/antigravity-1.2.12-execution-metrics.json)。 |
| Kiro 2.21.1；runtime-default，Provider 未公开 | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 条件可用：2 次正文增量 | 成功回合的 Core 终态读回；Usage 首次观测时间为空，见 [fixture](fixtures/kiro-2.21.1-execution-metrics.json)。 |
| TRAE CLI CN 0.120.52；runtime-default，Provider 未公开 | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 已测未上报 | 未验证：只有 1 次正文增量 | 成功回合的 Core 终态读回；Usage 首次观测时间为空，见 [fixture](fixtures/trae-0.120.52-execution-metrics.json)。 |

## 已接通的阶段与自动化证据

`monitoring.execution` 的 Run 部分复用现有 `runtime_usage_run_summary`，保持运行中已收到的数字和终态部分数字；Session 部分从原生 Gauge 独立持久化，按当前 Conversation 绑定、代次、原生 Session、已接受输入及后续模型／配置变化筛选。压缩后的旧 Gauge 不再读取。读取端和 Desktop/Web allowlist 均接通。Renderer 只对当前 Run 的公开根 Agent `agent.text.delta` 做 500 ms、约 1.5 s 平滑的速度估算；正文首见基线、重复、旧代次、工具以及静默衰减由单元测试覆盖。终态用量按钮四行、Session 小环与未知值用 `typecheck` 和布局测试验证；**本轮没有真实 Renderer 截图或交互验收**。

Rust 测试覆盖缺失与明确零、重复终态、累计计数重置、恢复基线、缓存包含输入、reasoning 不重复计数、CodeBuddy Gauge 去重、会话换代迟到事件。Codex 的 Core 重启读回证明保存与恢复主路径；Qwen 的 Gauge 和用量是分开来源。上述真实调用均为无工具短回合，不能据此声称多工具、失败、取消、并发、恢复和计数重置都经过对应 Runtime 的端到端验收。

## 未决事项与下一步核验

1. **账户或配置阻断**：Copilot 增加月配额，Qoder 增加模型服务余额，DSH 提供 `DEEPSEEK_API_KEY`，CodeBuddy 配置可用默认模型，再用相同隔离烟测取得健康终态的四桶与 Context。Cursor 先补 macOS 资格证据；Kimi、Grok 先解决其真实调用失败，再观察字段。
2. **已测未上报的来源**：Kiro、TRAE、Antigravity 的本次成功回合没有原生 Usage/Context；先捕获脱敏原始通知并核对实际模型、Provider 与协议方言，再判断是 Runtime 未上报，还是 adapter 未接。Claude、OpenCode、Pi、ZCode 的 Context 同理。Qwen、ZCode 的 Cache Write 必须看明确事件或版本语义，保持 `null`。
3. **Session 和流式边界**：Codex 两轮旧烟测的同线程断言失败，需按当前 Native Session 策略另做恢复探针。各 Runtime 仍需运行中的真实 Renderer 采样、途中打开、静默工具阶段、重连及纯终稿场景截图；只有流式正文且初始基线已建立时才显示当前速度。
4. **故障与压力场景**：在具备可调用配置后，逐 Runtime 采集多工具、失败、取消、超时、恢复、重复事件、重置、并发与 Session 换代的脱敏 wire fixture。当前自动化覆盖归一化和投影的重要边界，但不能代替这些原生回包。

当前实现合同见 [Runtime Execution Metrics v1](../../contracts/runtime-execution-metrics-v1.md)。
