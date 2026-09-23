---
document_type: runtime-research
runtime: command-code
upstream: CommandCodeAI/command-code
authority: research-evidence-only
status: proposed
admission: research
observed_version: 1.64.0
observed_platform: macos-arm64
last_updated: 2026-09-23
---

# Command Code Runtime 接入研究

本文记录实现前的本地检查与候选设计。它不增加 Product Runtime identity、平台准入或机器 Ready 证据。正式接入必须遵循 [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md)；产品目录与平台资格分别由 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md) 和 [Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md) 决定。

## 当前判断

候选路线是独立的 `command-code-cli` Adapter，采用 `one_shot_resumable` 进程策略，读取 Command Code 原生 `-p --output-format json` NDJSON，并按完整原生 Session ID 恢复。进程与输入收敛最接近 Claude Code；受管 `--mod` 可借鉴 Pi 的扩展投递思想；两者的协议、权限和配置结论都不能直接沿用。

这仍是 **Research**。目前没有目标 Runtime 的认证、模型、Tool、Session、MCP、权限或取消的真实 Smoke，所有平台的 qualification evidence 都为空。先验证权限失败语义、成员级 MCP 隔离、高权限 Bootstrap 连续性，之后再写正式 Adapter。若其中某项只能形成上游差异，需要当前版本决定明确接受，不能由研究文档宣称已支持。

## 2026-09-23 本机检查

本机为 macOS arm64，Node `v26.9.0`。PATH 中没有 `command-code`、`commandcode`、`cmdc` 或 `cmd`，探测前也没有 `~/.commandcode` 目录。把 npm 官方 `command-code@1.64.0` 安装到一次性临时目录，跳过 install scripts，仅执行 `--version`、`--help` 与 `mcp --help`，没有发送模型 Prompt 或使用认证。临时安装不属于 Rovai Product Runtime Installation。

**浅检测副作用：**即使设置 `COMMANDCODE_SKIP_UPDATES=1`，单独执行 `--version` 也会创建 `~/.commandcode/telemetry-install-id`。复核时先确认该目录此前不存在，再重跑一次 `--version` 并观察同一文件；两次均只出现这个 37 字节文件。探测后精确移除本轮新建文件与空目录。没有监测网络请求，不能从文件名推断实际遥测发送。Rovai 的 light probe 不能直接假设 `--version` 无落盘副作用；需要验证隔离配置根或其他无副作用身份读取办法，且正式认证运行仍须保留用户原生配置。

| 本地证据 | 观察 | 能证明的范围 |
| --- | --- | --- |
| npm registry manifest / 发布包 `package.json` | `1.64.0`；Node `>=22`；bin 包含 `cmd`、`cmdc`、`command-code`、`commandcode` | 目标发布包的入口与 Node 前置条件 |
| 发布包 `--version` | `1.64.0`，且创建 `telemetry-install-id` | 该临时入口可在本机启动至版本输出；不能直接视为无副作用浅检 |
| 发布包 `--help` | `-p`、`--output-format json`、`--resume`、`--session`、`--mod`、`--skill`、`--skip-onboarding`、`--no-auto-update`；没有 `acp` 子命令或 `--mcp-config` 参数 | 对 1.64.0 已公布 CLI 入口的观察；不能证明不存在其他未公开接口 |
| 发布包 `mcp --help` | `add/list/get/remove/add-json/auth` | MCP 管理命令存在；没有展示单次 Run 配置参数 |
| 本仓库 [`AdapterKind::ALL`](../../../crates/rovai-core/src/agent_profile.rs) | 16 个 closed identity，尚无 Command Code | 当前 Product Runtime Catalog 未接入 |

官方 [CLI Reference](https://commandcode.ai/docs/reference/cli) 与 [Headless Mode](https://commandcode.ai/docs/headless) 描述 `json` 输出为逐行 `AgentEvent`，最后一行是 `result`；`sessionId` 和 `stopReason` 在早期失败时可缺失。`--resume <id>` 可恢复指定 headless Session；`--continue` 取当前目录最近一次，不能用于 Rovai 的精确绑定。官方 [Sessions](https://commandcode.ai/docs/sessions) 说明 Session 存储与 cwd/project slug 关联，恢复还会读取原生模型状态。上述是文档证据，不是本次真实模型运行证据。

## 与现有 Runtime 的差异

| Rovai 形态 | 已有代表 | Command Code 的差异 |
| --- | --- | --- |
| ACP 常驻 Host | OpenCode、Kimi、Grok 等 | 1.64.0 CLI 未给出 ACP 服务入口；不能复用 `initialize/session/new/session/prompt`、标准 MCP 注入或 ACP permission request。 |
| 原生常驻协议 | Codex app-server、Pi JSONL RPC | Command Code 当前公开机器入口是一次 `-p` 运行后退出；没有已验证的可驻留请求/响应 Host。 |
| one-shot 原生协议 | Claude Code stream-json、Antigravity | 进程寿命相近，但 Command Code 使用自己的 `AgentEvent`/`result` NDJSON、Session 文件、权限与扩展 API，不能复用 Claude parser。 |
| 扩展投递 | Pi 受管 Extension | Command Code `--mod` 能按本次 CLI 启动加载 Mod；Mod API 标为 Experimental，且 print 模式的 UI 确认默认拒绝，不能照搬 Pi 的 Bootstrap 或 Approval 结论。 |

本仓库的 [`AgentRuntimeAdapter` registry](../../../crates/rovai-core/src/agent_runtime_adapter.rs) 是编译期接口，不是插件 ABI。新增 identity 还会触及可执行发现、平台准入、静态/深检、模型与权限 schema、Skill/MCP projection、AgentRun dispatch、Runtime Activity、Usage、终态、取消、设置/诊断投影。现有 [Claude one-shot 实现](../../../crates/rovai-core/src/claude.rs) 可参考 `ManagedProcess`、stdin 交付、进程树清理和 Input ACK 的控制流；[Core dispatch](../../../crates/rovai-core/src/application.rs) 仍需要独立 Command Code 分支。公共 [Managed Runtime Process v2](../../contracts/managed-runtime-process-v2.md) 已覆盖 one-shot 子进程，不需要 Adapter 私有进程池。

## 需要单独设计的行为

### 权限与 Headless

[Headless Mode](https://commandcode.ai/docs/headless) 和 [Permissions](https://commandcode.ai/docs/permissions) 表明 print 模式没有交互式提示，默认阻止会修改系统的 Tool；`--yolo` 可启用最高原生权限，但显式 deny/ask 规则仍可能限制它。Rovai 不能把 headless 的无交互路径映射成可靠的 allow-once UI。

[Shell Hooks](https://commandcode.ai/docs/hooks) 的 `PreToolUse` 可以主动拒绝，但非 `2` 的异常退出、退出 `0` 且输出 JSON 无效或 schema 不符时，工具仍可执行；因此它不能成为唯一的 fail-closed 外部审批桥。[Mods](https://commandcode.ai/docs/mods) 的 `beforeToolCall` 在原生 permission check 之后执行；print 模式下 `cmd.ui.confirm()` 返回 `false`。候选方案必须明确唯一审批权威，并用真实副作用测试验证 allow、deny、bridge 失败与取消。若只采用原生无交互权限，应在产品中如实暴露其能力差异。

### Session、Bootstrap 与 Compaction

候选的 `--resume <完整 sessionId>` 必须和当前 Conversation 的 Native Binding 一一对应；不能使用 `--continue`、Session 名称或 ID 前缀。`--session <path|id>` 是否能提供 Rovai 私有的持久路径以及其 cwd、模型和恢复失败语义，都需真实验证。对 `result.sessionId` 为空、进程失败和恢复失败必须区分 input 未接受、可能已接受和 continuity lost，不能把再次启动误作安全重试。

`--mod <path>` 与 `appendSystemPrompt` 是高权限 Bootstrap 的候选入口。[Mods](https://commandcode.ai/docs/mods) 说明它每轮构造 system prompt 时追加内容，但 API 为 Experimental，Mod 加载、hook 异常和后续 Mod 改写都需要固定版本实测。`SessionStart` Hook 只提供上下文且不阻止启动，不能用它承担必达 Bootstrap。压缩策略可候选 `native_system_prompt_preserved`，需要覆盖手动压缩、自动压缩、错误重试、cold resume 和跨成员无泄漏后才确定。

### MCP、Skills 与 Taste

官方 [MCP 文档](https://commandcode.ai/docs/mcp) 的 `local`、`project`、`user` 分别存于用户项目目录、仓库 `.mcp.json`、用户全局目录，不是 Rovai AgentRun/Native Session 作用域。本次 CLI 帮助未见类似 Claude `--mcp-config` 的单次投递参数。不能把 A 成员的 `PreparedMcpProjection` 写入共享 workspace 或用户配置，再让 B 成员并发运行。需要先验证官方单次覆盖能力；若无，可研究由受管 Mod `addTool` 承接 Core 的受限桥，但这意味着自己实现 MCP Tool 的名称、权限、取消、Server 生命周期和隔离，不能称作直接复用原生 MCP。

`--skill <path>` 是单次进程追加入口，比 MCP 容易投递；但官方 [Skills 文档](https://commandcode.ai/docs/skills) 规定项目、`.agents` 和用户 Skill 优先于额外路径。同名冲突、更新、撤销、相邻 Session 可见性仍需实测。`--no-skills --skill` 可以缩小发现面，但会改变 Command Code 原生 Skill 行为，不应在未决定产品差异前默认使用。

Command Code 的 [Taste](https://commandcode.ai/docs/taste) 默认学习，项目级 Taste 是共享工作区状态，且可发生额外模型调用。`--skip-onboarding` 只跳过 onboarding，不等于关闭学习。需要决定 Rovai 多成员是否共享此原生学习结果、是否应停用自动学习以及其用量如何归属；不能将 Taste 称为成员私有 Memory。不能靠改写共享 `.commandcode/settings.local.json` 实现每成员开关。

### 输出、Usage、更新与发现

只以 `result.subtype=success` 及匹配的 Session/Run 证据形成成功终态，`finalText` 只能作为 [Missing-Send](../../../crates/rovai-core/src/agent_profile.rs) 的 zero-send 恢复候选，不能直接广播。`AgentEvent` 的 Tool ID、cumulative/delta、stderr、非零退出、空输出和取消后的迟到事件仍要按当前 Action/Output 合同逐项映射。最终 `usage` 是文档化的 Run 总量候选；需要核对字段 scope、cache、重试与计数方式，不能从 Session totals 重复累计。

发现时建议首选跨平台 `command-code`，不用 macOS/Linux 的 `cmd` 别名作为 canonical identity；Windows 的 `cmd` 是系统解释器，Command Code 使用 `cmdc`。[CLI Reference](https://commandcode.ai/docs/reference/cli) 已说明此冲突。运行 `--no-auto-update` 可减少执行中版本漂移，但本机 `--version` 试验表明禁用更新不等于零本机写入；浅检要单独设计隔离。仍须以 executable fingerprint、reported version 和目标平台证据对 Ready 与 Qualification 分层；Node `>=22` 是额外的启动前置条件。

## 初始 Parity Matrix

下表将本次官方文档/本地帮助观察与 Rovai 实现分开；`DocumentationOnly` 不代表已通过真实行为验证。本机包启动至帮助页只验证入口，不能把任一功能轴标为 `Verified + Implemented`。

| Checklist 能力轴 | 上游证据 | Rovai 实现 | 最先要证明的事项 |
| --- | --- | --- | --- |
| Auth / Provider / Model | DocumentationOnly | NotImplemented | 原生认证、默认/显式模型、配置变化后的 Session fence |
| Host / Fleet / LRU | DocumentationOnly | NotImplemented | one-shot 退出、公共进程树清理和并发独立性 |
| Native Session / Continuation | DocumentationOnly | NotImplemented | 完整 ID warm/cold resume、错误 ID、模型恢复、唯一替代 Session |
| Bootstrap / Context | DocumentationOnly | NotImplemented | `--mod` 加载失败、逐轮注入、跨成员/恢复绑定 |
| Compaction continuity | DocumentationOnly | NotImplemented | 压缩与自动重试后 system prompt、Skill/MCP 和绑定连续性 |
| Skills | DocumentationOnly | NotImplemented | `--skill` 调用、覆盖/撤销和同名优先级 |
| External MCP | DocumentationOnly | NotImplemented | per-Run/Session 投递、相邻成员隔离、Server 清理 |
| Tool / Action / Command Output | DocumentationOnly | NotImplemented | 稳定 Tool ID、六类命令输出、重复/迟到归约 |
| Narration / Final / Missing-Send | DocumentationOnly | NotImplemented | authoritative result、stream 去重、zero-send/accepted-send |
| Permission / Approval / Workspace | DocumentationOnly | NotImplemented | 唯一权限权威、拒绝零副作用、异常 fail-closed |
| Built-in `rovai` CLI | NotObserved | NotImplemented | bundled CLI、当前操作集与每 Run lease |
| Usage / Cache / Cost | DocumentationOnly | NotImplemented | `result.usage` 字段、scope、retry/compact 归属 |
| Retry / Queue / Cancel / Cleanup | DocumentationOnly | NotImplemented | accepted 证据、SIGINT/TERM、迟到副作用与 descendant 清理 |
| Ready / Version / Platform | 本机仅验证 version/help，并观察到 `--version` 落盘 | NotImplemented | 无副作用浅检、auth Ready 与行为资格分层；每平台独立 Golden Flow |

## 建议的验证顺序

1. 固定 Command Code 版本与隔离测试账户/工作区，在 `-p --output-format json` 下采集一轮正常、认证失败、Tool 失败、取消的原生 wire；明确 result、exit code 与 Input accepted 证据。
2. 用两个成员共享同一 workspace，验证独立完整 Session ID、跨进程恢复、Bootstrap 与 Taste 边界；对 Mod 缺失/抛错做失败注入。
3. 证明 `PreparedMcpProjection` 可以只进入目标 Run/Session；如走 Mod bridge，先完成 Tool 权限、Server 生命周期和无泄漏最小闭环。
4. 再实现独立 Adapter 与 Core 映射，运行 Checklist 的所有 Golden Flows，并按 Runtime 版本和平台形成资格证据。

当前建议记录：`adapter_kind=command-code-cli`（候选）、`host_strategy=one_shot_resumable`（候选）、`nearest_production_adapter=claude-code-cli`、`admission=research`、`evidence_revision=null`、`accepted_upstream_differences=[]`。
