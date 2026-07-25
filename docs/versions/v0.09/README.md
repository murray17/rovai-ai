---
document_type: version-overview
version: v0.09
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-25
---

# Lumen AI v0.09 MCP Library

> 状态：已完成（检查点 5/5）
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.08 Skill Library 与 Runtime 原生发现](../v0.08/README.md)
>
> 跨版本约束：[ADR 索引](../../adr/README.md)

> 实施入口：[架构与协议](architecture.md) · [实施计划](implementation-plan.md)

## 版本目标

v0.09 在设置页增加名为“MCP”的入口，由 Lumen 统一管理外部 MCP
Server，并通过 `AgentRuntimeAdapter` 翻译为各 Runtime 的原生配置。

首次进入 MCP 设置时，Lumen 可以发现已知本机 Agent 配置中的 MCP Server，
供用户核对并一次性导入；没有可导入候选时，用户可以手动添加。

Lumen 内部固定的 Team MCP gateway 不属于 MCP Library，也不在该页面中
展示、导入或关闭。

## 已确认决策

### MCP-01 Lumen 独立真源与一次性导入

- MCP Library 是 Lumen 独立管理的应用级真源，不持续依赖 Cursor、Claude
  Code、Codex 或其他 Agent 的个人配置。
- 首次初始化只执行“发现候选 → 用户核对 → 一次性导入”；以后不建立自动
  同步、双向同步或来源监听。
- Lumen 不修改任何来源配置。用户在来源 Agent 中后续增删或修改 MCP，不会
  静默改变 Lumen 已导入的定义。
- 导入只复制可移植的 Server 定义；明文秘密、OAuth Token、会话凭据和
  Runtime 私有认证状态不复制。需要认证的候选必须由用户在 Lumen 中重新配置。
- Team MCP 是 Lumen 内部基础设施，不参与外部 MCP 导入、名称冲突或用户开关。

### MCP-02 统一模型与 Transport 边界

- MCP Library 保存 Lumen 自己的强类型 `MCP Server Definition`，不把 Cursor
  JSON、Codex TOML 或其他 Runtime 原始配置当作领域真源。
- v0.09 支持 `stdio` 与 `streamable_http` 两种 Transport：
  - `stdio` 保存 Command、Arguments、可选 Working Directory 和环境变量引用。
  - `streamable_http` 保存 URL 与可选 Header 引用。
- `AgentRuntimeAdapter` 负责把统一模型翻译为每个 Runtime 当前版本实际接受的
  原生配置；无法无损翻译时必须报告能力缺失，不能静默丢字段。
- 设置页可以采用类似 Cursor 的添加体验，但 UI 格式不定义持久化模型。
- v0.09 不允许新建旧式 SSE Server。导入发现 SSE 配置时只展示为
  “当前不支持”的候选，不保存为已启用 Server，也不偷偷降级为 HTTP。

### MCP-03 不内置第三方 MCP

- Lumen v0.09 不 Bundled、不预装、也不默认启用 Context7 或其他第三方
  MCP Server。
- 首次初始化只发现其他本机 Agent 已配置的 Server，用户确认后才导入。
- 没有可导入候选时，MCP Library 初始为空，设置页提供手动添加入口。
- Lumen 不替用户接受第三方服务条款、建立网络信任或选择默认凭据。

### MCP-04 用户级发现与手动重扫

- 首次进入 MCP 设置页时，Lumen 自动读取各 Importer 已知的用户级全局配置，
  生成只读候选列表；不递归搜索磁盘，也不扫描任何项目目录。
- 发现候选不会创建或启用 MCP Server。用户核对来源、名称和兼容性并确认后，
  才执行一次性导入。
- 首次初始化后保留“重新扫描本机配置”操作；它每次都重新生成候选，但不建立
  后台监听、定时同步或双向同步。
- 已导入 Server 不因来源配置被修改、移动或删除而自动变化。
- 扫描过程只读，任一来源解析失败不得阻塞其他来源或现有 MCP Library；
  UI 应按来源展示局部错误。

### MCP-05 全局定义、按成员分配

- `MCP Server Definition` 由 MCP Library 全局保存；是否向某个 Agent 暴露，
  由独立的 `MCP Assignment` 明确记录。
- 启用 Server 不等于自动暴露给所有 Agent。AgentRun 只能获得同时满足
  “Server 已启用、已分配给当前 AgentProfile、当前 Adapter 可翻译”的定义。
- 设置页为每个 Server 提供成员多选与“全部成员”快捷操作，但“全部成员”
  仍展开为明确 Assignment，不成为隐式全局权限。
- v0.09 不建立 Camp 级、Project 级或 Task 级 MCP 作用域。
- Agent 新加入 Camp 不改变 MCP Assignment；AgentProfile 被禁用或归档后
  不再启动新 Run，历史 Assignment 不承担运行状态语义。
- Team MCP 继续由 Lumen 固定注入，不属于 MCP Assignment。

### MCP-06 导入时默认分配当前全员

- 用户确认导入一个 MCP Server 时，默认勾选当时全部活跃 AgentProfile。
- 用户可以在导入确认界面取消成员，也可以在 MCP 详情页随时增删适用成员。
- “默认全员”只生成当时的显式 MCP Assignment；以后新增的 AgentProfile
  不会被静默授权，除非用户再次选择“全部成员”或手动勾选。
- Adapter 当前是否支持该 Server 的 Transport 不改变 Assignment；运行时由
  Adapter 能力检查决定是否可用，并向用户明确显示不兼容状态。

### MCP-07 单一本地配置文件

- `~/.lumen/mcp.json` 是外部 MCP Server 定义、启用状态和成员分配的唯一真源。
- v0.09 不新增 `mcp_server`、`mcp_assignment` 等 SQLite 表，也不把同一份配置
  同时复制到 SQLite。
- MCP 设置页是该文件的图形化编辑器；Import 也是读取来源后向该文件写入
  用户确认的定义。
- Core 必须以临时文件写入并在同一文件系统内原子替换，避免进程中断留下半个
  JSON 文件。
- 配置解析失败时保留原文件并报告明确错误，禁止用空配置自动覆盖。
- Adapter 所需的 Runtime 原生配置是按需生成的临时投影，不是第二份配置真源。

### MCP-08 本地明文配置与环境变量引用

- `mcp.json` 的 Stdio Environment 和 HTTP Headers 同时支持普通字符串与
  `${ENV_VAR}` 引用；文档和 UI 应优先推荐环境变量引用。
- 用户明确填写的 Token、Header 或环境变量值可以保存在 `mcp.json`，Lumen
  v0.09 不为 MCP 配置额外引入 Keychain 或 Secret Store。
- Core 创建文件后必须把权限收紧为当前用户可读写（POSIX `0600`）；发现权限
  过宽时在设置页警告，并提供修复操作。
- UI 对疑似敏感字段默认遮罩，并明确说明这些值保存在本机配置文件中；复制、
  导出和诊断不得无意泄露它们。
- Import 可以保留 `${ENV_VAR}` 一类引用，但不得自动复制来源中的明文凭据；
  候选应标记“需要重新填写凭据”。
- `~/.lumen/mcp.json` 不投影到项目目录，也不进入 Git 工作区。

### MCP-09 v0.09 不承载 OAuth 生命周期

- v0.09 支持 Stdio Environment、HTTP 静态 Headers 与 `${ENV_VAR}` 引用，
  不实现 MCP OAuth 登录、浏览器回调、Token 刷新、撤销或账号关联。
- Import 发现依赖来源 Runtime 私有 OAuth 状态的 Server 时，必须标记为
  “认证不可移植”，不得复制 Token、Cookie、Credential Cache 或账号状态。
- 某个 Runtime 能依靠自身登录状态访问 Server，不代表其他 Runtime 可以复用；
  Adapter 不得伪造跨 Runtime OAuth 兼容。
- 未来出现明确需求时，应把 Credential Broker 作为独立安全设计评估，不能在
  v0.09 的静态 MCP 配置中隐式扩张。

### MCP-10 首批用户级 Importer

v0.09 只从以下用户级入口发现候选：

| 来源 | 用户级入口 |
|---|---|
| Codex | `$CODEX_HOME/config.toml`，默认 `~/.codex/config.toml` |
| Claude Code | `~/.claude.json` 顶层 `mcpServers` |
| OpenCode | `$OPENCODE_CONFIG`，或 `~/.config/opencode/opencode.json(c)` |
| GitHub Copilot CLI | `$COPILOT_HOME/mcp-config.json`，默认 `~/.copilot/mcp-config.json` |
| Antigravity | `~/.gemini/config/mcp_config.json` |
| Cursor | `~/.cursor/mcp.json` |

- Cursor 虽然不是 Lumen AgentRuntimeAdapter，仍可作为可移植 MCP 配置来源。
- Claude Code Importer 不读取已过时的 `~/.claude/mcp.json`，也不解析
  `~/.claude.json` 中按项目保存的 Local 配置。
- 环境变量覆盖只在 Lumen 进程实际可见时生效；否则回退到官方默认路径。
- 任一来源不存在、无权限或格式错误，只产生该来源的局部状态，不阻塞其他
  Importer、现有 `mcp.json` 或手动添加。
- 不读取 `.codex/config.toml`、`.mcp.json`、`.cursor/mcp.json`、
  `.agents/mcp_config.json` 等项目级入口。

### MCP-11 名称冲突与显式替换

- MCP Server 名称在 `mcp.json` 的 `mcpServers` 中全局唯一。
- 同名且规范化后的可移植配置完全相同，视为已存在并幂等跳过。
- 同名但配置不同，Import 必须让用户选择“替换现有配置”“改名导入”或“跳过”，
  不能静默覆盖。
- “替换现有配置”只更新连接定义，保留原有启用状态和 MCP Assignment，避免
  Import 意外扩大或收回成员权限。
- 配置相同但名称不同，应提示可能重复并默认不选；用户仍可明确保留两个别名。
- 来源路径与来源 Agent 只作为导入说明，不建立同步身份，也不影响后续编辑。

### MCP-12 AgentRun 快照生效，不更换 Native Session

- AgentRun 启动时解析并冻结一份 `MCP Exposure Snapshot`；正在执行的 Run 不因
  `mcp.json` 改动热切换工具，也不被强制中断。
- 后续 AgentRun 使用最新配置，同时继续 Resume 原 Conversation 当前绑定的
  Native Session；MCP 变化不是 Native Session 兼容键。
- Adapter 可以为应用新配置重启临时 CLI 或 Agent Host 进程，但 Host 生命周期
  不得与 Native Session、Conversation 身份混淆。
- 当前 Codex、Claude Code 与 Copilot CLI 均能在 Resume 时同时接受本轮 MCP
  配置；当前 OpenCode/Copilot ACP 路径已按 AgentRun 隔离进程级 MCP 配置。
- Adapter 如果无法在保留 Native Session 时安全应用最新定义，必须把该 Server
  对该 Adapter 标记为不可用，不能静默继续暴露已禁用或旧配置。
- 只重新解析受配置变化影响的成员；其他 Agent 的 AgentRun 不受影响。

### MCP-13 Lumen 逐轮驱动，Agent CLI 执行协议

- 每次 AgentRun 都由 Lumen 根据 `MCP Exposure Snapshot` 生成
  `MCP Runtime Projection`，并在启动或恢复 Agent CLI 时注入。
- Lumen 决定本轮 Server 清单；Agent CLI 作为 MCP Client，实际启动 Stdio
  Server、连接 Streamable HTTP、发现工具并发起调用。
- Runtime Projection 必须只包含本轮已启用且已分配的外部 Server，以及固定的
  Team MCP。Runtime 个人配置中未导入或未分配的 MCP 不得绕过该清单自动出现。
- 各 Adapter 使用自己的当前原生机制：
  - Codex 产品路径使用 App Server 的完整 `mcp_servers` 请求级覆盖；`codex exec
    --config` 只用于本机诊断与真实 Runtime Smoke，不是第二条产品执行路径。
  - Claude Code 使用临时配置及 `--mcp-config --strict-mcp-config`。
  - Copilot CLI 保留用户原有 `COPILOT_HOME`，以继续使用已有认证和 Provider
    状态；启动前枚举并逐项禁用其他 Personal、Workspace 与 Plugin MCP，再通过
    `--additional-mcp-config` 追加本轮私有投影，同时禁用 Built-in MCP。
  - OpenCode 使用 ACP `session/new` / `session/load` 的 `mcpServers`，或等价的
    隔离进程配置。
- Antigravity companion `agy 1.1.6` 当前没有已验证的逐轮 MCP 注入入口；
  v0.09 将外部 MCP 标记为该 Adapter 不支持，不修改其用户全局配置来伪造支持。
- v0.09 不建立通用 MCP Proxy；Team MCP Bridge 仍是 Lumen 内部通信的特例。

### MCP-14 Adapter 原生权限与如实标注

- 外部 MCP Tool Call 首先遵循当前成员已明确选择的 Adapter 原生权限配置。
- Runtime 提供可关联 AgentRun、Execution Epoch 与具体 Tool Call 的执行前授权
  回调时，Lumen 继续通过现有 Action/Approval 协议持久化并响应。
- Runtime 不提供可靠回调时，Lumen 只能记录其实际可观察到的事件，不能在产品
  文案或审计中宣称该调用已经经过 Core 审批。
- MCP 设置页按成员与 Adapter 展示控制能力：
  `Lumen 可拦截`、`Runtime 原生控制` 或 `当前不支持`。
- v0.09 不增加独立的按 MCP/Tool 永久允许、永久拒绝或二次 Permission Profile；
  避免与 Adapter Permission Configuration 形成两套冲突策略。
- Team MCP 继续使用 Core Capability、AgentRun/Execution Epoch fencing 与私有
  Binding Credential 确定性校验，不依赖外部 MCP 的权限边界。

### MCP-15 只做静态校验，不实现独立 MCP Client

- v0.09 保存配置时校验 Schema、名称、Transport、URL/Command、成员引用与
  Adapter 翻译能力。
- 打开设置页、启动应用或扫描来源配置时，不自动执行第三方 Stdio Command，
  也不主动访问 Streamable HTTP URL。
- 实际连接、MCP Initialize 和 Tool Discovery 只在 AgentRun 内由 Agent CLI
  执行；失败作为对应 Runtime/AgentRun 错误展示。
- MCP 页面只显示“配置有效”“配置错误”“当前 Adapter 不支持”等可证明状态，
  不把未经连接验证的 Server 标记为在线或健康。
- v0.09 不提供 Tool Catalog、“测试连接”或后台健康轮询，避免为设置功能新增
  第二套 MCP Client、进程生命周期和网络安全边界。

### MCP-16 结构化设置页与外部文件编辑

- 设置页新增“MCP”入口，以紧凑列表展示名称、启用状态、Transport、适用成员
  和 Adapter 兼容性。
- “添加 MCP”和“编辑”使用结构化表单：
  - Stdio：Name、Command、Arguments、Working Directory、Environment。
  - HTTP：Name、URL、Headers。
  - 两者都包含启用状态和适用成员。
- 每行提供启用/禁用、编辑和删除；页面顶部提供“从本机 Agent 导入”与
  “打开 `~/.lumen/mcp.json`”。
- Renderer 不内置 Monaco、CodeMirror 或原始 JSON 文本编辑器。
- 用户在外部修改文件后，Lumen 必须重新读取；解析失败时显示文件位置与错误，
  保留原内容且不得用 UI 中的旧值覆盖。
- 页面同时遵守 Day/Night 功能等价、可见 Label、键盘操作、Focus Visible
  和状态不只依赖颜色等现有 UI 规范。

### MCP-17 AgentRun 私有投影支持确定性恢复

- AgentRun 首次启动时生成不可变的私有 MCP Runtime Projection，并以 POSIX
  `0600` 保存在 Lumen Runtime 私有目录；它不进入项目或 MCP Library。
- Context Manifest/运行记录只保存 Exposure 清单、配置摘要和私有投影引用，
  不把 Header、Token 或 Environment 明文复制到 SQLite。
- 同一个 AgentRun 因应用或 Agent Host 重启恢复时继续使用原投影，不根据已经
  变化的 `mcp.json` 重新组装。
- AgentRun 进入终态后清理私有投影；Retry 创建新 AgentRun，并使用当时最新的
  MCP 配置。
- 私有投影丢失、损坏或摘要不一致时，原 AgentRun 明确失败；不得拿当前配置
  冒充原执行环境。

### MCP-18 v0.09 不跨 Runtime 搬运 Tool Filter

- v0.09 的外部 MCP 可用粒度是整个 Server，不建立通用单 Tool Allowlist 或
  Denylist。
- 来源没有 Tool Filter，或显式表示全部工具（例如 `*`），可以正常进入导入
  候选。
- 来源包含限制性的 `enabled_tools`、`disabled_tools`、`tools` 或等价字段时，
  候选必须标记“工具限制无法移植”，并默认不选中。
- 用户只能明确选择“按全部工具导入”或跳过；Lumen 不得静默丢弃过滤器后启用。
- 未来只有在各 Adapter 的工具隐藏/拒绝语义得到可执行验证后，才重新评估
  Tool 级跨 Runtime 控制。

## 已核实的外部配置入口

这些位置是导入候选来源，不是 Lumen 的长期真源：

- Cursor：用户级 `~/.cursor/mcp.json`；项目级 `.cursor/mcp.json`。
- Claude Code：用户级 MCP 位于 `~/.claude.json`；共享项目配置位于项目根
  `.mcp.json`。`~/.claude/mcp.json` 不是当前标准入口。
- Codex：用户级 `~/.codex/config.toml`；受信任项目可使用
  `.codex/config.toml`。

首次初始化只扫描 MCP-10 列出的用户级入口，不扫描项目目录，也不递归搜索磁盘。

## 实施结果

- `~/.lumen/mcp.json` 已成为唯一外部 MCP 真源；配置通过严格 Schema、原子替换、
  Digest CAS 与 POSIX 权限校验管理，损坏文件不会被空配置覆盖。
- 设置页已提供空状态、列表、结构化增删改、启停、成员分配、权限修复、打开配置
  文件和按来源分组的一次性导入；首次扫描只发现候选，不自动写入。
- AgentRun 已冻结脱敏 Exposure 与私有 Runtime Projection；配置变化只影响后续
  Run，不更换 Conversation 或 Native Session。
- Codex、Claude Code、OpenCode 与 Copilot CLI 已完成真实本机 MCP Tool Call；
  Antigravity 明确显示不支持，且不会被写入用户配置。
- 打包后的 App 已在白昼 `1440×920` 与夜间 `1040×700` 完成导入、秘密遮罩、
  手动添加、成员调整、启停、权限修复和删除验收；默认 Library 中没有 Context7。
- 完整实现与可复现命令见[实施计划](implementation-plan.md)。
