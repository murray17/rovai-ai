---
document_type: adr
id: ADR-0065
title: Verified Runtime Catalog and Documentation-Only Compatibility Evaluation
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.19
supersedes: [ADR-0016]
superseded_by: null
---

# ADR-0065: Verified Runtime Catalog and Documentation-Only Compatibility Evaluation

## Context

v0.19 的初始方案曾考虑把 Runtime 的“可发现目录”和“可执行准入”分成两层，并允许未
达到执行边界的产品进入设置与持久化类型。实际评审发现，这会让用户看到无法运行的产品，
也把临时调研状态固化成 `AdapterKind`、Migration、Contracts 和 Renderer 分支，维护
成本与产品价值不成比例。

Rovai-ai 仍需持续调研新的 Agent CLI。不同 Runtime 对 MCP 的控制能力并不相同：有的能
严格替换一次 Run 的 MCP 集合，有的只能注入 Rovai MCP 而保留原生配置，还有的不能注入。
这些兼容性结论需要保存，但不应自动成为产品领域类型。

## Decision

### 产品目录只包含已接入 Runtime

`AdapterKind`、`adapter_installation` 的封闭集合、TypeScript Contracts 和 Renderer
选项只包含已经实现、可以冻结并执行 AgentRun 的 Runtime。未接入候选不作为
catalog-only 条目出现在产品中，也不预留枚举值、路径配置、健康状态或迁移分支。

Core 继续通过编译时 `AgentRuntimeAdapter` Registry 解析 Runtime。每次 Run 仍冻结实际
可执行路径、fingerprint、协议、模型、权限和能力；运行中不因探测结果变化而静默更换
Adapter 或安全边界。

### 当前实现继续以精确 MCP 能力准入

当前版本只有观察到 `mcp.exact_per_run` 且具备所需认证、Session、恢复和取消能力的
新增 Runtime 可以进入产品目录。精确投影要求 Rovai-ai 提供的 Team MCP 与外部 MCP
集合不会被用户、项目、插件或兼容层 MCP 静默扩充。

v0.19 新增 `kiro-cli`、`qoder-cli`、`codebuddy-cli` 和 `qwen-code`：

- Kiro 从 Rovai-ai 私有进程目录加载 `includeMcpJson: false` 的专用 Agent，并通过 ACP
  `session/new` / `session/load` 接收每 Session MCP；真实 AgentRun 工作目录和 Kiro
  原生持久 Session 不被替换。
- Qoder、CodeBuddy 和 Qwen 使用一次性私有 MCP 配置及各自验证过的 strict/allowlist
  参数。

健康探测必须使用与生产启动一致的隔离入口创建 disposable Session；仅版本输出或 ACP
`initialize` 不能产生 Ready snapshot。

### 兼容性候选只保存在项目文档

尚未接入的 Runtime、验证版本、协议入口、MCP 行为、认证前提和复核条件统一记录在
[`docs/runtime-compatibility.md`](../runtime-compatibility.md)。该清单是工程调研证据，
不是 Runtime Registry、产品 Roadmap 或用户可见能力。

“精确替换”“可注入但保留原生配置”“不能注入”只作为文档评估语言，不新增 projection
mode 枚举、数据库字段、冻结配置字段或 UI 标签。

未来若选择接入“可注入但保留原生配置”的 Runtime，应在对应版本中明确 Rovai 只保证
自身注入的 MCP，不保证原生 MCP 集合；该 Runtime 可以担任 Lead，不因这一兼容性差异
被产品角色系统降级。一次 AgentRun 冻结后不得静默改用其他投影策略。当前版本不实现
这一准入路径，也不考虑不能注入 Rovai MCP 的 Runtime。

## Consequences

- 设置、健康检查和成员配置只展示实际可运行的 Runtime，不再暴露调研占位项。
- 新候选的调查结论可以长期积累，而不会扩大领域枚举、Migration 和 Renderer 的维护面。
- 当前新增 Runtime 仍采用较强的 Exact MCP 门槛；未来放宽准入需要版本内实现与验证，
  但不要求先引入通用模式类型。
- Kiro 需要维护私有 Agent 配置格式、进程启动目录与 ACP Session 工作目录分离的回归
  测试。

## Rejected Alternatives

- 在产品中保留无法冻结执行的 catalog-only Runtime。
- 为文档调研结论新增 projection mode 类型并持久化或展示给用户。
- 因 MCP 兼容性较弱而禁止一个已准入 Runtime 担任 Lead。
- 在一次 Run 中因探测失败或配置变化静默降级投影策略。
- 当前版本接入不能注入 Rovai MCP 的 Runtime。

## References

- [Runtime 兼容性清单](../runtime-compatibility.md)
- [v0.19 Runtime 扩展](../versions/v0.19/README.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0059: Runtime-Owned Resource Permissions](0059-runtime-owned-resource-permissions.md)
- [ADR-0062: Interruptible Runs and Unsettled External Effects](0062-interruptible-runs-and-unsettled-external-effects.md)
