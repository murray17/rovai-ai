---
document_type: runtime-research
runtime: command-code
authority: research-evidence-only
status: implementation-in-progress
admission: research
observed_version: 1.64.0
observed_platform: macos-arm64
last_updated: 2026-09-23
---

# Command Code 1.64.0 实现前 Parity Matrix

本矩阵按 [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md) 建立，先于正式 Adapter 实现。最接近的生产 Adapter 是 `claude-code-cli`；公共控制流可参考它，Command Code 的 wire 与能力证据必须独立取得。`DocumentationOnly` 仅指 [官方 CLI/Headless/Mods/MCP 文档](https://commandcode.ai/docs)或发布包帮助，未替代真实账号、模型、Tool 或 Session Smoke。开发者已选择普通 Prompt 引导；[精确输入提案](prompt-guidance-proposal.md)尚待二次确认，当前 Version Decision 尚未正式接受此产品差异。

| 能力轴 | Rovai 标准行为 | Command Code 1.64.0 上游能力面 | 候选接入策略 | 当前状态与证据 | 已接受差异 |
| --- | --- | --- | --- | --- | --- |
| Auth / Provider / Model | 自身原生认证、默认/显式模型、变化后精确 fence | 原生认证/BYOK、`--model`、`--list-models` | 继承用户原生配置；Probe 区分认证与模型目录，保存后核对显式模型 | `--list-models` 可见隔离 BYOK；headless 仍以退出码 3 拒绝未登录；完整轴未实现 | 无 |
| Host / Fleet / LRU | 声明进程策略并统一管理生命周期 | `-p` 单次 query 后退出；未见驻留 RPC | 候选 `one_shot_resumable`，每 Run 一个受管进程 | ManagedProcess 传输已实现并通过假 CLI 测试；真实 Runtime 生命周期未验证 | 无 |
| Native Session / Continuation | 稳定完整 ID，warm/cold/Core restart 精确恢复 | `result.sessionId`、`--resume <id>`；`--continue` 选最近一次 | 只保存完整 ID；未知/失败不自动重投 accepted input | 本机 local-only fixture 已验证指定 ID 续接和不存在 ID 失败；真实账号、Core restart 未验证 | 无 |
| Bootstrap / Context | 高权限 Charter/Identity/Memory，逐 Run 冻结上下文 | 普通 `--print` stdin；`--mod` 与 `appendSystemPrompt`、Home `AGENTS.md` 可注入 system prompt，但失败时继续模型调用 | 用户选择每 Run 将 Bootstrap 与冻结 Dynamic Context 合成普通 user Prompt；实现前按精确提案二次确认 | fixture 已验证 Mod 失败语义；普通 Prompt 路线尚未实现 / NotImplemented | 用户已选择降低指令层级；正式差异决定待记录 |
| Compaction continuity | 压缩与恢复后绑定、能力不变 | 原生压缩及 `compaction_*` events | 每个新 AgentRun 重投普通 Prompt 引导；同一次原生多轮执行内的压缩仍需验证或列明能力缺口 | DocumentationOnly / NotImplemented | 无 |
| Skills | 现有 Assignment 追加、更新、撤销、隔离 | 单次 `--skill <path>`；额外路径优先级低于项目/用户 | 使用现有 delivery group 的 Run-local 受管路径；验证同名规则 | DocumentationOnly / NotImplemented | 无 |
| External MCP | `PreparedMcpProjection` 仅目标 Run/Session 可见 | 原生 MCP 主要持久 local/project/user scope；无已观察单次配置 flag | 先确认其他官方隔离入口；否则评估受管 Mod/Tool 桥与完整生命周期 | DocumentationOnly / Blocked | 无 |
| Tool / Action / Output | native ID 唯一生命周期、六类命令输出 | `tool_queued/running/update/completed/errored/denied` 等事件 | 独立 NDJSON parser，按 ID 状态机归一；未知 event 私有忽略或失败 | 本机 fixture 已采集 completed、hook-blocked、denied；Core 事件归约已写，六类命令输出及真实 Tool 未完成 | 无 |
| Narration / Final / Missing-Send | 私有 thinking、权威终态、zero-send 恢复 | `text_delta`、`message_end` 与最终 `result` | 仅 `result.success` 形成成功；final 只作恢复候选 | fixture 已验证文本与 result；公开事件投影剔除 `run_end.nextState`；Missing-Send 未完成 | 无 |
| Permission / Approval / Workspace | 唯一审批权威、deny/cancel 零副作用 | headless 无交互；`--yolo`；Shell Hook 非法输出可能放行，Mod confirm 默认拒绝 | 先证明原生无交互模式与错误路径；不声明虚假审批 UI | fixture 中 `dont-ask` 阻止 shell；`--yolo` 与 `dont-ask` 组合仍拒绝 `touch`，未证明每 Run Approval | 无 |
| Built-in `rovai` CLI | 当前 bundled CLI 与每 Run lease | 原生 shell 可执行普通 CLI，未做目标实测 | 复用 Built-in process config，运行完整 operation Smoke | NotObserved / NotImplemented | 无 |
| Usage / Cache / Cost | 已知字段归入 canonical buckets，未知 NULL | 最终 `result.usage`；具体字段/计数语义未实测 | 只在 scope 与 counter mode 证明后落库 | DocumentationOnly / NotImplemented | 无 |
| Retry / Queue / Cancel / Cleanup | accepted fence、唯一终态、整树清理 | `run_start/run_end/interrupted`、headless exit codes | 确定 native accepted 点；统一 ManagedProcess 处理取消与 shutdown | 传输层有取消与整树清理；真实 accepted/cancel/恢复语义未验证 | 无 |
| Ready / Version / Platform | 静态身份、认证 Ready、平台资格分层 | `--version`、`status --json`、Node `>=22`；普通 `--version` 会落盘 | 浅检隔离；深检沿用用户配置；每平台独立证据 | 本机 `DO_NOT_TRACK=1` 浅检未落盘；`status --json` 为未认证；未接产品 Probe | 无 |

## 实施准入顺序

1. 用固定 1.64.0 发布包和隔离工作区记录真实 NDJSON、失败、取消、精确恢复与原生 Tool 事件；确认 Runtime 接受输入的最早可证明时点。
2. 按 [Prompt 引导提案](prompt-guidance-proposal.md)取得二次确认后，在首次与精确恢复的模型请求中验证 Bootstrap 仅以普通 user Prompt 投递；保留 Mod 失败证据，但不再以 Mod 作为 Rovai Bootstrap 路径。
3. 证明成员 A 的 MCP、Skills、Taste 与权限在同 cwd 成员 B 的并发/后继 Run 中不泄漏；没有单次 MCP 注入方案前，保持此轴 `Blocked`。
4. 在上述隔离与权限策略确定后实现完整 Adapter、Catalog、Probe、dispatch、Usage、Settings/诊断投影；各目标平台运行 Checklist Golden Flows 才可升级资格。

设计中不把通用 Core 基础设施的存在记作 Command Code 的 `Implemented`。当前 Product Runtime Catalog 和各平台 Admission 均不增加 Command Code；普通 Prompt 引导的降低权限差异、是否进入 preview 或正式目录仍须由后续当前 Version Decision 与证据明确。
