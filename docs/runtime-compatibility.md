---
document_type: runtime-compatibility-register
authority: runtime-validation-evidence
last_updated: 2026-08-15
---

# Agent Runtime 兼容性清单

本文件维护 Agent Runtime 的本机实测证据和复核条件。它不是产品 Runtime Registry、
Roadmap 或用户可见能力来源；正式目录以代码中的 `AdapterKind`、Migration、健康探测和
测试为准。跨版本边界见
[ADR-0065](adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)与
[ADR-0189](adr/0189-settings-only-runtime-preview-outside-product-catalog.md)。

兼容性清单中的自然语言结论本身不会自动创建产品类型。v0.42 起，Rovai-owned built-in
operations 的正式准入基线是 [ADR-0124](adr/0124-cli-only-transport-for-rovai-built-in-operations.md)：
Runtime 必须能执行 bundled `rovai` CLI，经 private local IPC 调用 Core Router。旧 Team、
Context、Memory MCP transport、Bridge、Plugin 与 Runtime-native built-in MCP config 已完全
退出当前架构；用户 External MCP 是另一条独立能力，不参与 built-in tool 准入判断。

## 当前 Product Runtime Catalog

当前 closed `AdapterKind` 包含十种可执行 Runtime：Codex CLI、OpenCode、GitHub Copilot、
Claude Code、Antigravity、Kiro、Qoder、CodeBuddy、Qwen Code 与 TRAE CLI CN。设置页的
DeepSeek Harness “待支持”行是 Renderer-only Preview，不在这个目录中，也没有 Installation、
Probe、成员选择、诊断或 AgentRun 语义。

### TRAE CLI CN v0.83 准入记录

2026-08-15 在临时工作目录直接启动 `traecli acp serve`，实测版本为 `0.120.52`、build commit
`6756e52a9238b6d493928e55b05127957dbfefb4`、build date `2026-08-12T01:31:30Z`。本次没有修改
用户级 TRAE 配置，也没有把当前模型、Session 或 instruction 路径写为静态产品能力。

| 能力轴 | 实测结论 | Rovai v0.83 边界 |
| --- | --- | --- |
| Protocol / auth | `initialize.protocolVersion = 1`；当前登录态 `authMethods=[]`；stdout 仅合法 JSON-RPC | 明确认证错误映射 `authentication_required`；协议/shape 缺失映射 `incompatible`；I/O/timeout 保持 transient |
| Session / model | `session/new` 返回稳定 ID、动态 model select（本次 16 项）和 `default/bypass_permissions/plan` modes；跨 Host `session/load` 通过 | Catalog 每次从 Session 建立；只要求并默认安全 `default`，不默认 `--yolo` |
| Prompt / cancel | 普通 prompt 返回 `end_turn`；tool 期间 cancel 返回 `cancelled` 且目标文件未出现 | 进入既有 ACP terminal/cancel 边界；第一版 Run 完成后停止 Host，不声称 warm reuse |
| Tool / Approval | `toolCallId` 生命周期稳定；结构化 permission request 的 option ID 可执行 allow/reject | 映射现有 Action/Approval；拒绝后无文件，allow-once 后只有目标写入 |
| External MCP | Session A 通过 `mcpServers` 追加 fixture 并真实调用；同 Host 未配置 Session B 不可见 | 沿用 `AdditivePerRun / RovaiWins`，不新增 Transport、全局配置副本或额外 MCP 隔离层 |
| System prompt / Charter | `append_system_prompt` 实际形成独立 system message，marker Probe 通过；冲突实验中模型仍可能选择 user 指令 | capability 保留为观察证据；正式 AgentRun 沿用 `FirstPayload` Charter，不写 TRAE 配置，也不把 native append 当作唯一正确性边界 |
| Skill / recovery | TRAE 会读取原生用户 instruction，但未证明 Rovai Skill 路径；ACP `end_turn` assistant suffix 稳定 | Skill discovery 保持 documentation-only empty；Missing-Send Recovery 的 zero-send、accepted-send suppression、tool→final 三场景通过 |

脱敏 Snapshot、Probe 步骤和分类限制见
[TRAE CLI CN ACP Probe](research/trae-cli-runtime/probe/README.md)。真实 Ready 只证明上述安装与账号；
上游 executable、协议或 capability 改变后必须重新 Probe。

同日定向正式验收通过：`smoke:acp-runtime` 完成 completion、Native Session 续接、Approval
allow-once/deny；`smoke:missing-send-recovery` 在 tool→final 场景观察 8 个结构化 ACP tool event；
`smoke:mcp-projection` 返回 `rovai-projection:trae_cn`。TRAE Host 在 durable terminal 对后继 Run
可见前停止，后继 Host 再以 `session/load` 恢复同一 Session，避免 cwd、权限或 Run 配置跨 Host 延伸。

### v0.85 Transport v12 当前基线

当前字段级合同已推进到 [Built-in Tool Transport v12](contracts/builtin-tool-transport-v12.md)，固定十四项
operation，并加入 direct user-triggered 的 `member.create`。catalog、CLI help/projection、幂等重放、
A2A 拒绝、头像路径 Evidence 脱敏和十 Runtime qualification 脚本已通过确定性门禁或完成脚本对齐。
本版本未重跑十种 Runtime 的真实十四项联合 matrix，因此下方十三项表仍只是各历史版本的实机证据，
不能推导为 v12 pass。

## 既有九 Runtime Built-in CLI 正式接入证据

2026-08-13 的 v0.67 `pnpm smoke:builtin-cli` 为九个 Runtime 分别创建隔离 Core data-dir、Skill Library
和 Git workspace，并运行真实模型 AgentRun。每个 Runtime 都完成 13 个 canonical operation、16 条目标
Core Evidence、direct/stdin/input-file 三种 send 输入、public-only `--to-user`、Agent+user 双轴发送、
stale-version recovery、完成后的旧 lease fencing 和后继 AgentRun 新 lease。由于当前 Run 的 Context 是
冻结快照，三条新消息的 exact `camp.read(mode="item")` addressing 由后继 Run 验证；这不是同一 Run
读取接受后新消息的伪影。每个 Case 同时拒绝旧/虚构 send input，并验证 compact success stdout 不暴露
`local_user` 或 Notification ID。

同日 `pnpm smoke:skills` 为九个 Runtime 分别验证 `cli-operations` 的复杂协调触发。真实模型从 managed
Skill projection 读取该 Skill，运行 `rovai task create --help` 与 `rovai send --help`，输出 exact
`--to-user`，且没有制造 `rovai task --help`、多余的 `task update` 或
`--request-user-attention` 等不存在/不适用的入口。
该矩阵同时验证七项 official inventory、默认九组和 managed symlink；不是把 prompt 中的静态答案当作
Skill 使用证据。

| Runtime | v0.67 实测版本 / CLI model | 13 项操作 / 三 send 输入 / exact read | conflict / lease fence | continuation | CLI / Skill 结论 |
|---|---|---|---|---|---|
| Codex CLI | `codex-cli 0.147.0` / `gpt-5.6-sol` | pass | pass / pass | logical + native | pass / pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | pass / pass | logical + native | pass / pass |
| GitHub Copilot | `GitHub Copilot CLI 1.0.79` / `claude-sonnet-5` | pass | pass / pass | logical + native | pass / pass |
| Claude Code | `2.1.220` / runtime default | pass | pass / pass | logical + native | pass / pass |
| Antigravity | `1.1.12` / runtime default | pass | pass / pass | logical + native | pass / pass |
| Kiro | `2.16.1` / `auto` | pass | pass / pass | logical + native | pass / pass |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | pass | pass / pass | logical + native | pass / pass |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | pass | pass / pass | logical + native | pass / pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | pass / pass | logical + native | pass / pass |

这张 v0.67 表是前九种 Runtime 的历史真实矩阵，不把 v0.83 新增的 TRAE 冒充为已运行同一轮
十三操作与 Skill 验收。TRAE 的本版定向 AgentRun/MCP 证据单独记录在上节与 v0.83 实施计划中。

九个 Runtime 的 Envelope/Projection 样本分别观测到 57.4%–57.9% 字节缩减；这是 observability
metric，不是兼容性门槛。Antigravity 的 `agent_run.started` 在首轮日志确认前没有 Session ID，因此
联合脚本以随后持久绑定的 `agent_run.native_session_bound` 为准；修复后的专项
`pnpm smoke:antigravity-runtime` 实测两次 Run 使用同一 Native Session。Kiro `2.16.1` 的 focused
`ROVAI_BUILTIN_CLI_ADAPTERS=kiro-cli pnpm smoke:builtin-cli` 复测也证明 successor Run 复用同一
Native Session：Adapter 在终态对外可见前停止持有 Session lock 的 per-Run Host，再由新 Host 执行
`session/load`；smoke 现以 session ID 相等作为硬断言。transport-independent response-loss、
`outcome_indeterminate` 与无 locator stop 继续由确定性 CLI/Core 测试覆盖。

该历史矩阵当时的字段级合同为 [Built-in Tool Transport v8](contracts/builtin-tool-transport-v8.md)，
调用结构以 [Built-in Tool Runtime Architecture](architecture/builtin-tool-runtime.md) 为准。上方九 Runtime
矩阵仍是 v7 的真实模型证据，不能冒充 v8 收窄后的 schema/help/Charter/Skill 教学已经完成实机复测；v8
的确定性测试已证明 catalog digest、三类分离示例与 Antigravity binding replacement。

v0.70 关闭时只有 Codex 聚焦复测：以全新隔离 Core data-dir 和 Native Session 运行 Codex CLI
`0.147.0` / `gpt-5.6-sol`，在内部 handoff 没有新增用户决定、回答或行动时，真实模型读取 exact help
后选择 `attention=omit --to-user`，最终结构化 Camp Message 不含 `current_user_mention`。由于其余
八个 Runtime 尚未运行，v0.70 以 `closed_incomplete` 冻结。

关闭后于 2026-08-13 从 v0.70 最终产品快照 `a6397f32` 构建 Core/CLI，并为每个 Case 使用全新隔离
Core data-dir、Skill Library、Git workspace 与 Native Session，追溯补跑 Built-in CLI v8 和 managed
Skill v8 九 Runtime 矩阵：

| Runtime | v0.70 补测版本 / CLI model | Built-in CLI v8 | managed Skill v8 |
| --- | --- | --- | --- |
| Codex CLI | `0.147.0` / `gpt-5.6-sol` | pass | pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | pass |
| GitHub Copilot CLI | `1.0.79` / `claude-sonnet-5` | blocked：月度配额耗尽 | blocked：月度配额耗尽，两次一致 |
| Claude Code | `2.1.220` / runtime default | pass（聚焦重试） | pass |
| Antigravity | `1.1.12` / runtime default | pass | pass |
| Kiro | `2.16.1` / `auto` | pass | pass |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | pass | pass |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | pass | pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | pass |

八个 Built-in pass 均覆盖十三项 canonical operation、direct/stdin/input-file 三种 send 输入、successor
exact reads、stale-version conflict、旧 lease fencing、新 lease 与 logical/native continuation。八个
Skill pass 均覆盖 managed projection、私有 marker、exact task/send help、消息局部 attention、重启
恢复、Shadowed 与删除边界。Copilot 两类用例都在接受输入后明确返回月度配额耗尽，故记为外部条件
阻塞，不记 pass，也不归因于 v0.70 产品失败。

这组追溯证据的结论是两类矩阵各 `8/9 pass + 1 blocked`，不是完整 `9/9`。它也不能倒推 v0.70
在关闭时满足发布门槛；版本状态继续是 `closed_incomplete`。完整执行口径和 smoke 假阴性修正记录在
[v0.70 实施计划](versions/v0.70/implementation-plan.md)。

### 历史 v0.47 Transport v4 基线

2026-08-08 的 v0.47 联合矩阵曾证明九个 Runtime 的十三项 Transport v4 操作、冲突恢复与 lease
fencing；每个完整 AgentRun 观察到 14 条 Core Evidence，Envelope/Projection 缩减为 51.1%–51.5%。
该历史证据不能单独证明 v0.67 的 `--to-user`、exact Camp read addressing、精确 help 或
`cli-operations`；这些边界由上方 v7 矩阵接替。

## Missing-Send Recovery Publication

2026-08-12 的 v0.59 验收使用 `pnpm smoke:missing-send-recovery`，为每种 Runtime 分别创建临时
Core `data-dir` 和临时 Git workspace。每个真实 Runtime 都完成：零次 `rovai send` 时由 Core 发布
一条 recipient-free recovery，以及一次 accepted `rovai send` 后抑制不同 Runtime final。六个 ACP
Runtime 还必须用原生文件工具读取请求中未披露的随机 token，再以 `end_turn` 返回该 token；验收同时
要求数据库中存在真实 tool activity，并把实际 ACP 事件交给独立 Node 协议重建器。断言直接读取
SQLite 中的 source Run、author、literal Text、source operation、recipient arrays、Delivery count、
terminal decision 和 `finalCampMessageId`，不以 Renderer 或 stdout 文本代替。

| Runtime | 实测版本 / 模型 | zero-send | accepted-send suppression | ACP tool→final / protocol | 结论 |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.147.0` / `gpt-5.6-sol` | pass | pass | 不适用；completed-turn parser fixture pass | pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | pass | pass / pass（6 tool events） | pass |
| GitHub Copilot | `GitHub Copilot CLI 1.0.79` / `gpt-5.6-sol` | pass | pass | pass / pass（2 tool events） | pass |
| Claude Code | `2.1.220` / runtime default | pass | pass | 不适用；success-result parser fixture pass | pass |
| Antigravity | `1.1.12` / runtime default | pass | pass | 不适用；exact print-stdout marker pass | pass |
| Kiro | `2.16.1` / `auto` | pass | pass | pass / pass（2 tool events） | pass |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | pass | pass | pass / pass（2 tool events） | pass |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | pass | pass | pass / pass（87 tool events） | pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | pass | pass / pass（3 tool events） | pass |

最终统一报告与六份 ACP 协议 fixture 位于
`/Users/murray.xue/Downloads/Rovai-ai-comparison-2026-08-12/acceptance/missing-send-recovery-v059/final-all-nine/`。
Copilot 默认 `claude-sonnet-5` 的 zero-send 路径通过，但该模型三次拒绝从 Camp 输入执行 shell，因此
不把其模型拒绝冒充 suppression pass；最终统一矩阵为 Copilot Adapter 显式选择同一真实 Runtime
model catalog 中的 `gpt-5.6-sol`，报告记录了实际选择。该模型行为观察不改变 Core 的全 send 抑制
规则，也不以模拟 send 替代 Runtime 调用。

## Copilot Native Turn reconciliation

2026-08-12 的 v0.64 P1 使用 GitHub Copilot CLI `1.0.79`、固定模型 `gpt-5.4` 和 executable SHA-256
`637f85f8c6aa0c1b03ba0949ab2d7dbc705d2f0519802fa92c5493841d93925f`，在隔离 Git workspace 上完成
control、in-flight Host kill、terminal-before-persist Host kill 各两个有效重复。每个 Host B 都只执行
`initialize + session/load` 两次，从未发送 prompt。

| 观察项 | 六个有效样本的结果 |
| --- | --- |
| Host A prompt / 唯一 Tool Call / workspace nonce | 每项均恰好 1 |
| Host B prompt / execution permission request | 每项均为 0 |
| Session history replay | 可重复；Control 重放 Tool Call 与最终文本，terminal kill 只重放 completed Tool Call |
| Provider 生成的稳定 Native Turn ID | 未返回 |
| 机器可判的 Turn 状态 | 未返回；只能记为 `ambiguous` |
| 旧 Turn terminal result / prompt response 重读 | 不可取得 |
| `native_turn.reconcile.v1` | `capability_not_proven` |

history replay 没有造成第二次 Tool Call 或 nonce，但也不能证明 Provider 模型请求 exactly-once；ACP v1
不暴露该计数。该实测是目标 executable/version 的负向 capability 证据，不影响 Copilot 其他已通过的
Runtime admission 能力，也不把 Session load 提升为旧 Turn reattach。协议、逐 case artifact、raw 脱敏
ledger 和 digest manifest 见
[v0.64 P1 实验](versions/v0.64/copilot-native-turn-reconciliation-experiment.md)。

## Claude Code 与 ACP 输入确认

2026-08-11 使用本机 Claude Code `2.1.220` 按 Adapter 的完整参数执行无工具、无 Session 持久化的
`stream-json + include-partial-messages` focused smoke：约 1.4 秒出现匹配请求 UUID 的 `system init`，
约 4.9 秒出现同一 Session 的 `stream_event/message_start`，约 5.1 秒出现 success `result`，最终正文为
`CLAUDE-STREAM-ACK-SMOKE`。当前 Adapter 明确排除 system/Hook/status，只允许匹配 Session 的模型 stream
或 assistant event 提前确认，并保留 success result fallback。该 smoke 只验证输入确认 surface，不替代
上表十三项 Built-in CLI qualification。

OpenCode、Copilot、Kiro、Qoder、CodeBuddy 与 Qwen 的输入确认由同一 ACP Host 实现。确定性回归确认
`session/prompt` stdin write/flush 不再直接 ACK；当前 active prompt 的 agent message/thought、plan、tool、
permission request 可提前确认，匹配 request ID 的成功 response 为 fallback，usage/mode/catalog update 不
确认，明确 error response 在尚无 accepted evidence 时结算为 `not_accepted`。这项共享实现不改写上表
各 Runtime 的实测版本；上游若改变 ACP `session/update` 或 prompt response shape，须重新执行对应真实
Runtime smoke。

## Antigravity one-shot 输入确认

2026-08-11 使用本机 `agy 1.1.12` 执行只读 `--print --mode plan --sandbox` smoke：同一份私有日志先后
观察到 `Created conversation`、`Print mode: conversation=...`、匹配 Conversation 的
`Forwarding user message` / `Sending user message`，随后出现
`v1internal:streamGenerateContent?alt=sse` 的 `ResponseID`，最终 stdout 正常返回且进程成功退出。
该 focused smoke 只验证 one-shot accepted marker，不替代上表 `1.1.11` 的十三项 Built-in CLI
qualification，也不据此改写完整兼容性版本。

当前 Adapter 以“匹配 Session 的 forward/send 之后出现 stream response ID”作为进程仍运行时的
早期 accepted evidence；Conversation 创建和本地 forwarding 本身不确认投递。marker 缺失或格式变化
时 fail closed 到原有 terminal settlement；若进程失败且两条路径都无法验证，则保持
`delivery_unknown`。已持久化 accepted ACK 后的生成失败不会降级或重放输入。确定性 fixture 覆盖
response-before-forward、forward-without-response、new/resumed Session、早期 ACK 先于 final、非零退出
和 ACK 后取消；上游升级若改变任一 marker，必须重新执行本节 smoke 与相关 Adapter 回归。

## Native Session compaction detector

2026-08-08 的 v0.48 qualification 对六个目标 Runtime 执行真实 compaction，并观察 Rovai 选择的
官方结构化 surface。detector 是 `best_effort` 内部增强能力；此表证明目标版本上 signal 可达，不把
detector readiness 提升为 Runtime admission 条件。

| Runtime | 实测版本 | 真实操作与观察 | v0.48 admission / transport | 结论与边界 |
| --- | --- | --- | --- | --- |
| GitHub Copilot | `1.0.78` | ACP Session 内真实 `/compact` 触发 Plugin `preCompact`，后续 ACP prompt accepted | one-shot `preCompact`；隔离 `--plugin-dir` | pass；目标 Hook payload 不带 event name，relay command 冻结 expected source；Unix Hook 使用 `bash` 字段 |
| OpenCode | `1.18.10` | server summarize 完成并发出 native `session.compacted` | completed；隔离 native Plugin，prompt 保持 ACP | pass；ACP inbound 本身不转发该 native event |
| Kiro | `2.16.1` | `_kiro.dev/commands/execute compact` 后观察 status `started`、`completed` | 仅 nested `params.status.type=completed`；现有 ACP inbound | pass；summary 不参与 admission 或 evidence digest |
| Qoder | `1.1.14` | 真实 `/compact` 触发 `PostCompact(manual)` | completed；隔离 `--settings` Hook | pass |
| CodeBuddy | `2.133.1` | 强制真实 emergency auto compaction 完成后触发 `SessionStart(source=compact)` | completed；隔离 `--plugin-dir` Plugin Hook | best-effort pass；CLI additional settings 未进入 Hook registry。该版本 pre-message compaction 实测绕过 `PreCompact`、`PostCompact` 和 `SessionStart(compact)`，因此存在已记录的 detector coverage gap，不使用 token heuristic 补猜 |
| Qwen Code | `0.21.5` | 真实 `/compress` 完成并触发 `PostCompact(manual)` | completed；私有 `QWEN_HOME` user-scope Hook | pass；HookRegistry 不读取 system Hook，trigger matcher 为 exact match，配置 `*` 后由 relay 校验 trigger |

Claude Code 与 Codex CLI 的 Bootstrap 位于普通 compaction 不触及的 instruction layer，不建立
detector。Antigravity v0.48 policy 为 `disabled`，因为尚无合格 compaction lifecycle event；Rovai 不
使用 token 数或 context telemetry 猜测 compaction。detector 建立失败、短暂中断或恢复都不改变九个
Runtime 的 Built-in CLI 兼容性结论。完整时序与持久边界见
[Native Session Bootstrap Redelivery](architecture/native-session-bootstrap-redelivery.md)。

## External MCP 兼容性

External MCP Library、Assignment 与 Runtime-native Projection 保持独立。v0.43 已按
[ADR-0125](adr/0125-runtime-native-additive-external-mcp-projection.md) 删除精确替换模型；下表记录
当前实现通道。代码与确定性测试已经通过，原生不同名保留、同名整项优先和真实 tool call 仍须
完成 Checkpoint 7 实机矩阵后才能作为发布证据。

| Runtime | Projection / 同名策略 | 当前动态通道 | 实机发布证据 |
|---|---|---|---|
| Codex CLI | `AdditivePerRun` / `NativeWinsSkip` | app-server `config/read` discovery + thread `config.mcp_servers` | 待 v0.43 矩阵 |
| OpenCode | `AdditivePerRun` / `RovaiWins` | ACP Session `mcpServers`，保留 native config roots | 待 v0.43 矩阵 |
| GitHub Copilot | `AdditivePerRun` / `RovaiWins` | `--additional-mcp-config` | 待 v0.43 矩阵 |
| Claude Code | `AdditivePerRun` / `RovaiWins` | `--mcp-config`，不使用 strict | 待 v0.43 矩阵 |
| Kiro | `AdditivePerRun` / `RovaiWins` | Custom Agent `mcpServers` + `includeMcpJson: true` | 待 v0.43 矩阵 |
| Qoder | `AdditivePerRun` / `RovaiWins` | native `--mcp-config`，不使用 strict/allowlist | 待 v0.43 矩阵 |
| CodeBuddy | `AdditivePerRun` / `RovaiWins` | native `--mcp-config`，不使用 strict | 待 v0.43 矩阵 |
| Qwen Code | `AdditivePerRun` / `RovaiWins` | native `--mcp-config`，不使用 allowlist | 待 v0.43 矩阵 |
| TRAE CLI CN | `AdditivePerRun` / `RovaiWins` | ACP Session `session/new` / `session/load` 的 `mcpServers` | `0.120.52` 原生 Session A/B 追加与不泄漏 Probe、正式 Core smoke 均通过 |
| Antigravity | `Unsupported` | 无不修改 Global/Workspace 文件的逐 Run 动态通道 | 诊断披露；配置页保持中立 |

## 历史：内置 MCP / Antigravity 专项复核

以下记录只解释 v0.30–v0.32 当时的实现和证据，不能作为当前运输合同，也不表示旧 MCP
实现仍被保留。Antigravity 当前与其他八个 Runtime 一样使用 bundled CLI。

| 复核日期 / 版本 | 已观察证据 | 当前实现结论 | 仍需复核的边界 |
|---|---|---|---|
| 2026-08-01 / `agy 1.1.9`（v0.30 历史证据） | 专属 Plugin 可启动无凭据 MCP；Bridge 是 `agy` 直接子进程；macOS kernel peer PID/start/parent/path 可读取；当时的精确 `mcp(rovai_team/post_message)` 在真实 headless model call 生效；调用 `_meta` 有稳定 conversation/progress identity；Bridge 崩溃后 `agy` 不重启；真实 A→B→A 与普通终端负例通过 | 证明 Attested Bridge 拓扑与无凭据进程绑定可行，不证明 v0.32 `call_member` 协议 | 该历史证据自身不能证明新 alias、Schema、Return Obligation、Outcome 或自动 Resume；v0.32 复核见下方，不能改写本行冒充新协议实测 |
| 2026-08-02 / `agy 1.1.9`（v0.31 历史证据） | packaged Core 上真实模型依次完成 13 个 canonical Team/Context/Memory tool receipt、A2A leaf、Task version 2、Context Summary、1 个 Memory Revision、1 个 pending Hearth proposal 与 Core restart 无重复；普通 `agy` 的 `tools/list` 为空、13 个 direct call 全为 `run_not_bound`、领域写入为零；同一 Core 上 Codex `0.146.0` 与 OpenCode `1.18.5` 的十三工具回归通过。修复配置的 CAL-001 又真实完成 Context/Memory/Task/Team reply、文件编辑与测试，四角色以 7 AgentRun / 6 A2A 在原预算内收敛 | 增加 `BuiltInMcpToolParity::Complete`；十三条 exact permission bundle、catalog/protocol/Schema/Session compatibility 与统一 Core handler 已落地。AGY execution/attachment workspace、Prepared Binding 授权、非交互权限和 final-output 结算已修复；Qualification 显式使用 per-run skip-permissions。该结论只表示内置工具运输与语义对等，不提升 External MCP，也不改变 `PreservedUncontrolled` | 原始 `delivery_unknown` 有效失败仍保留；修复后校准为 valid pass，但十二次自主 Trial 尚未运行。`sandbox=on` 与 auto-approved bypass 不是严格安全隔离。上游 CLI、模型、Plugin/权限格式或父子进程行为变化后仍须整套复核 |
| 2026-08-02–03 / `agy 1.1.9`、Codex CLI `0.146.0`、OpenCode `1.18.5`（v0.32） | 新 `call_member` Schema 分别在真实 Codex→Codex 与 AGY→AGY Smoke 上完成 A→B→A；重启后无重复物化。普通未绑定 AGY 的 `tools/list` 为空，13 次直接调用均为 `run_not_bound`。随后 Team Pack revision 4 校准通过，12 个正式 Trial 共观察到 72 Run、60 Member Call、30 显式 Return、30 completed Task；12/12 协作审计、12/12 同成员单槽、0 轮询，4 个 Trial 直接捕获忙时 pending Input | v0.32 breaking alias、持久 Input、显式 Return、忙时 FIFO、自动 Resume、Attested Protocol 3 与 Alias Map 2 已获得跨三种 Runtime 的正式执行证据。OpenCode 使用 `opencode/big-pickle`；此前 `north-mini-code-free` 的真实 Spike 漏掉 Task、测试和返回，不再作为默认 tester | safe Core Outcome 和 pre-materialization Outcome 已由事务/集成测试覆盖；本轮正式 Trial 全走显式 Return，仍需专门的真实 Outcome/重启 Case。正式 Pass Rate 4/12，功能 6/12、边界 10/12、协作 12/12；协议可用不代表最终业务整合稳定。`sandbox=on` 与正式 Runner 的 skip-permissions 仍不构成严格安全隔离 |

前两条是 v0.30/v0.31 历史协议证据，第三条才是 v0.32 breaking protocol 的真实 Runtime
复核。编译、单元/集成测试和静态契约仍不能替代这条实测；反过来，一次真实显式 return
链路也不能替代 Outcome、取消、容量与 crash 分支的确定性测试。

这些历史证据不证明当前 CLI 合同；旧 Plugin、Bridge、permission bundle、`rovai_team`
保留名与 ambient built-in MCP attachment 都已在 v0.42 删除。单工具历史验收见
[v0.30](versions/v0.30/README.md)，完整十三工具与 Qualification 结果见
[v0.31](versions/v0.31/README.md)。

## 未接入候选与 Settings Preview

普通调研候选不应出现在 `AdapterKind`、数据库 kind、Contracts、设置选项或运行时健康目录。
ADR-0189 只允许 Runtime 设置页追加严格 presentation-only 的 Preview；Preview 不改变本文件的
准入结论，也不进入任何 Core surface。

| Runtime | 调研版本 / 状态 | 观察结果 | 当前边界 / 未接入原因 | 复核条件 |
|---|---:|---|---|---|
| Kimi CLI | 0.29.2 | ACP 可初始化；调用方 `mcpServers` 会与用户、项目、项目本地及插件 MCP 合并 | 尚未进入 Product Runtime Catalog，也没有 additive 同名与恢复矩阵 | 完成登录、真实 turn、恢复/取消、native preservation 与 same-name policy 复核 |
| Grok CLI | 0.2.112；本机未登录 | ACP 可初始化；初始化阶段可观察到个人 MCP | 缺少登录后的完整 Session、工具与 additive precedence 证据 | 完成登录、真实 turn、恢复/取消与 MCP 行为复核 |
| Cursor Agent | 2025.09.18-7ae6800 | 支持 headless 与 resume；已验证入口会读取项目 `.cursor/mcp.json` | 尚无稳定的逐 Run additive channel 与同名证据 | 上游提供动态追加入口并完成 native preservation、同名与恢复复核 |
| DeepSeek Harness | Settings Preview；未实现 | 仅显示名称、图标、`待支持` 与 disabled 状态；没有 executable、Adapter、Probe 或 capability 结论 | Renderer-only preview，不属于 Product Runtime Catalog | 取得明确入口和协议后，完成 Adapter、认证、Session、终态、取消、Approval、Tool ID、MCP、Activity、Migration 与真实 AgentRun 准入 |

## 后续准入规则

- 新增 Runtime 的 built-in tool 准入要求真实模型能执行 bundled `rovai` CLI，并通过固定命令、
  十三项调用、旧输入负向、冲突 recovery、Envelope Evidence、lease fencing 与后续 AgentRun 验证；具有 shell/
  bash 能力但尚未通过矩阵，只能视为待验证，不能以理论支持替代证据。
- Runtime 不得通过内置 MCP、native Plugin、stdio Bridge 或 ambient MCP 获得 Rovai built-in
  operations；也不得在 CLI 失败时静默回退到旧运输。
- External MCP 继续以独立的 additive per-Run 投影合同验收；必须证明 native preservation、
  Adapter-specific same-name policy、最终 Exposure 与 Ready 注入失败路径，且不能用于承载或模拟
  Rovai built-in operations。
- 已准入 Runtime 可以担任 Lead；兼容性差异不进入角色系统。

## 官方入口

- [Kiro CLI ACP](https://kiro.dev/docs/cli/acp/)
- [Kiro CLI MCP](https://kiro.dev/docs/cli/mcp/)
- [Kiro Custom Agent configuration](https://kiro.dev/docs/cli/custom-agents/configuration-reference/)
- [Qoder CLI permissions and MCP allowlist](https://docs.qoder.com/en/cli/permissions)
- [CodeBuddy CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference)
- [Qwen Code configuration](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/)
- [Kimi Code CLI ACP](https://moonshotai.github.io/kimi-code/en/guides/ides.html)
- [Grok Build CLI reference](https://docs.x.ai/build/cli/reference)
- [Cursor Agent CLI parameters](https://docs.cursor.com/en/cli/reference/parameters)
- [TRAE Enterprise](https://www.trae.ai/enterprise)
- [Antigravity MCP Servers](https://antigravity.google/docs/mcp)
- [Antigravity Plugins](https://antigravity.google/docs/plugins)
- [Antigravity CLI Permissions](https://antigravity.google/docs/cli/permissions)
