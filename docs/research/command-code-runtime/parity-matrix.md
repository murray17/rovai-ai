---
document_type: runtime-research
runtime: command-code
authority: research-evidence-only
status: implementation-in-progress
admission: research
observed_version: 1.64.0, 1.65.2, 1.66.0
observed_platform: macos-arm64
last_updated: 2026-10-04
---

# Command Code Parity Matrix（1.64.0 fixture；1.65.2 真实 BYOK）

本矩阵按 [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md) 建立，先于正式 Adapter 实现。最接近的生产 Adapter 是 `claude-code-cli`；公共控制流可参考它，Command Code 的 wire 与能力证据必须独立取得。`DocumentationOnly` 仅指 [官方 CLI/Headless/Mods/MCP 文档](https://commandcode.ai/docs)或发布包帮助，未替代真实账号、模型、Tool 或 Session Smoke。开发者已在 Camp 消息 `f70e9798-8f5c-4428-821f-bd51ec0b99f6` 确认当前 [first_payload revision 4](prompt-guidance-v1.70-proposal.md)；此确认不提升其他能力轴或平台资格。

| 能力轴 | Rovai 标准行为 | Command Code 1.64.0 上游能力面 | 候选接入策略 | 当前状态与证据 | 已接受差异 |
| --- | --- | --- | --- | --- | --- |
| Auth / Provider / Model | 自身原生认证、默认/显式模型、变化后精确 fence | 原生认证/BYOK、`--model`、`--list-models` | 继承用户原生配置；Probe 区分认证与模型目录，保存后核对显式模型 | `--list-models` 可见隔离 BYOK；headless 仍以退出码 3 拒绝未登录；完整轴未实现 | 无 |
| Host / Fleet / LRU | 声明进程策略并统一管理生命周期 | `-p` 单次 query 后退出；未见驻留 RPC | 候选 `one_shot_resumable`，每 Run 一个受管进程 | ManagedProcess 传输已实现并通过假 CLI 测试；真实 Runtime 生命周期未验证 | 无 |
| Native Session / Continuation | 稳定完整 ID，warm/cold/Core restart 精确恢复 | `result.sessionId`、`--resume <id>`；`--continue` 选最近一次 | 只保存完整 ID；未知/失败不自动重投 accepted input | 本机 local-only fixture 已验证指定 ID 续接、不存在 ID 失败，且同 cwd 的第二个隔离 Home 无法恢复第一个 Home 的 ID；真实账号、Core restart 未验证 | 无 |
| Bootstrap / Context | 高权限 Charter/Identity/Memory，逐 Run 冻结上下文 | 普通 `--print` stdin；`--mod` 与 `appendSystemPrompt`、Home `AGENTS.md` 可注入 system prompt，但失败时继续模型调用 | 复用现有 `first_payload`：新 Session 的普通 user Prompt 包含 Bootstrap 与冻结 Dynamic Context，普通精确恢复仅发本 Run 动态上下文 | 内部传输要求 `PreparedContext.runtime_payload`；本机隔离 fixture 验证首次两次模型请求的 user 层 Bootstrap、精确恢复仅新 `P` 且原生历史保留旧 `B`；正式 AgentRun Context 接线未实施 | [当时确认的研究提案](prompt-guidance-proposal.md)接受普通用户指令层级，不能宣称高权限 parity |
| Compaction continuity | 压缩与恢复后绑定、能力不变 | 原生压缩及 `compaction_*` events | 沿用 Core 合格信号后的下一次 Bootstrap 补发；先证明 Command Code 信号、同一次原生多轮执行内压缩及 cold resume 行为 | DocumentationOnly / NotImplemented；没有合格 signal 时此轴不能宣称通过 | 无 |
| Skills | 现有 Assignment 追加、更新、撤销、隔离 | 单次 `--skill <path>`；额外路径优先级低于项目/用户 | 使用现有 delivery group 的 Run-local 受管路径；验证同名规则 | DocumentationOnly / NotImplemented | 无 |
| External MCP | `PreparedMcpProjection` 仅目标 Run/Session 可见 | 原生 MCP 主要持久 local/project/user scope；无已观察单次配置 flag；1.64.0 `--config 'mcp={}'` 在启动前拒绝 | 研究私有 Home 的原生用户级 MCP 投影，并证明认证/设置同步、与原生 project MCP 兼容、Secret、撤销及 Server 生命周期；必要时再评估受管 Mod/Tool 桥 | 本机双 Home fixture：A 可搜索、在 yolo 下调用私有 stdio MCP，B 同 cwd 无该 Tool；dont-ask 拒绝且无 tools/call。`PreparedMcpProjection`/生产生命周期未实现，仍 Blocked | 无 |
| Tool / Action / Output | native ID 唯一生命周期、六类命令输出 | `tool_queued/running/update/completed/errored/denied` 等事件 | 独立 NDJSON parser，按 ID 状态机归一；未知 event 私有忽略或失败 | 本机 fixture 已采集 completed、hook-blocked、denied；Core 事件归约已写，六类命令输出及真实 Tool 未完成 | 无 |
| Narration / Final / Missing-Send | 私有 thinking、权威终态、zero-send 恢复 | `text_delta`、`message_end` 与最终 `result` | 仅 `result.success` 形成成功；final 只作恢复候选 | fixture 已验证文本与 result；公开事件投影剔除 `run_end.nextState`；Missing-Send 未完成 | 无 |
| Permission / Approval / Workspace | 唯一审批权威、deny/cancel 零副作用 | headless 无交互；`--yolo`；Shell Hook 非法输出可能放行，Mod confirm 默认拒绝 | 先证明原生无交互模式与错误路径；不声明虚假审批 UI | fixture 中 `dont-ask` 阻止 shell 和私有 MCP；原生 yolo 的私有 MCP 可调用；`--yolo` 与 `dont-ask` 组合仍拒绝 `touch`。真实审批、文件/网络副作用与取消未闭合 | 无 |
| Built-in `rovai` CLI | 当前 bundled CLI 与每 Run lease | 原生 shell 可执行普通 CLI，未做目标实测 | 复用 Built-in process config，运行完整 operation Smoke | NotObserved / NotImplemented | 无 |
| Usage / Cache / Cost | 已知字段归入 canonical buckets，未知 NULL | 最终 `result.usage`；具体字段/计数语义未实测 | 只在 scope 与 counter mode 证明后落库 | DocumentationOnly / NotImplemented | 无 |
| Retry / Queue / Cancel / Cleanup | accepted fence、唯一终态、整树清理 | `run_start/run_end/interrupted`、headless exit codes | 确定 native accepted 点；统一 ManagedProcess 处理取消与 shutdown | 传输层有取消与整树清理；真实 accepted/cancel/恢复语义未验证 | 无 |
| Ready / Version / Platform | 静态身份、认证 Ready、平台资格分层 | `--version`、`status --json`、Node `>=22`；普通 `--version` 会落盘 | 浅检隔离；深检沿用用户配置；每平台独立证据 | 本机 `DO_NOT_TRACK=1` 浅检未落盘；`status --json` 为未认证；未接产品 Probe | 无 |

## 1.65.2 真实调用后的证据增量

[真实 BYOK Smoke](real-byok-smoke-2026-09-25.md)把 Auth/显式 Model、原生同 UUID warm 恢复、`read_file`、`edit_file`、`shell_command` stdout/stderr/空输出/非零退出，以及手动 `/compact` 后的原生 cold CLI 恢复从 `NotObserved` 推进到 **upstream Verified on macOS arm64, 1.65.2, one isolated account/session**。`result.usage` 的四个 token 字段已观察到，但 scope、累计方式和 Rovai 归属未验证。`gpt-6-sol` 未出现在当次 `/v1/models` 响应中，却能通过 Command Code 官方 Provider 配置显式调用；catalog/Ready 不能由该列表单独裁定。

这些增量没有改变对应 Rovai implementation：Product Adapter、AgentRun dispatch、Native Binding/Input Delivery、App Camp Action/Usage、Builtin CLI、Skills/MCP、Approval/cancel、Compaction redelivery 和逐平台 qualification 仍为 `NotImplemented` 或 `Blocked`。1.65.2 的 `dont-ask` 实测读成功、edit/command 被拒；显式 `--yolo` 则能完成隔离 edit/command。当前内部传输固定 `dont-ask`，直接接 Camp 会阻断写和命令，必须先设计并验收唯一权限权威。原生非零 Shell 退出仍产生 `tool_completed`、CLI 顶层 `result.success`，内部 staged normalizer 已补充按终态文本退出码归为失败，并隐藏 read/edit 的结果正文；实际 App Action 尚未验证。旧表中 `1.64.0` 单元格只描述固定版本 fixture，不能读成 1.65.2 的所有轴已过关。

## 1.66.0 真实 Core 数值增量（2026-10-04）

官方 1.66.0 在隔离 Home/workspace、真实 sub2api/gpt-6-sol 下通过 Core headless transport：
首次及同 UUID 恢复，四个 token 桶的逐调用和与原生 result 相等，Context 使用最新根调用的含缓存输入。
恢复后 5 调用输入 69,309、输出 399、cache read 39,680、cache write 0；最后 Context used 14,721。
运行中可观察数值；reasoning、窗口、比例、费用仍未知。实现与数值证据见
[Usage/Context 验收](../runtime-monitoring/command-cline-verification-2026-10-04.md)。
这推进了内部 transport 的 Usage parser，不代表尚不存在的 Product AgentRun/App 链路通过；
上表 1.64.0 的历史测试结论保留各自范围。当前内部传输显式接受原生 `dont-ask` 或 `yolo`，
不再固定 `dont-ask`；真实工具数值 Smoke 显式使用隔离 workspace 的 `yolo`，产品审批仍未闭合。

同日[文件与窗口复核](../runtime-monitoring/command-cline-files-context-2026-10-04.md)在真实 1.66.0 中
确认 read_file/edit_file 均携带 `input.file_path`，内部 Activity 现在保留独立 `filePath`，不公开文件正文。
编辑实测还证明 `--permission-mode yolo` 单独不足以通过 headless 写入 gate；仅为已选择 Yolo 的请求
补齐原生 `--yolo` 后，修改与原生读回均成功。DontAsk 不添加该开关。窗口字段仍未观察到，
这些证据仍不代表 Command Code Product Adapter/App 已接入。

## 实施准入顺序

1. 用固定 1.64.0 发布包和隔离工作区记录真实 NDJSON、失败、取消、精确恢复与原生 Tool 事件；确认 Runtime 接受输入的最早可证明时点。
2. [Prompt 引导 revision 3](prompt-guidance-proposal.md)已二次确认；本机 fixture 已验证首次与精确恢复请求中的普通 user Prompt 位置。继续在正式 AgentRun Context 接线后验证相同字节和 Input Delivery；Mod 失败证据保留，不作为 Rovai Bootstrap 路径。
3. 证明成员 A 的 MCP、Skills、Taste 与权限在同 cwd 成员 B 的并发/后继 Run 中不泄漏；没有单次 MCP 注入方案前，保持此轴 `Blocked`。
4. 在上述隔离与权限策略确定后实现完整 Adapter、Catalog、Probe、dispatch、Usage、Settings/诊断投影；各目标平台运行 Checklist Golden Flows 才可升级资格。

设计中不把通用 Core 基础设施的存在记作 Command Code 的 `Implemented`。当前 Product Runtime Catalog 和各平台 Admission 均不增加 Command Code；普通 Prompt 引导的降低权限差异已由 当时研究提案接受，是否进入 preview 或正式目录仍须额外证据与完整产品接入决定。
