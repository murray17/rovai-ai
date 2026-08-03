---
document_type: runtime-compatibility-register
authority: runtime-validation-evidence
last_updated: 2026-08-03
---

# Agent Runtime 兼容性清单

本文件维护 Agent Runtime 的本机实测证据和复核条件。它不是产品 Runtime Registry、
Roadmap 或用户可见能力来源；正式目录以代码中的 `AdapterKind`、Migration、健康探测和
测试为准。跨版本边界见
[ADR-0065](adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)。

兼容性清单中的自然语言结论本身不会自动创建产品类型。跨版本决策
[ADR-0088](adr/0088-attested-native-team-gateway-attachment.md) 已进一步要求 Adapter 和
AgentRun 分别表达外部 MCP 投影、内部 Team Gateway attachment 与 ambient isolation；
[ADR-0089](adr/0089-attested-built-in-mcp-tool-parity.md) 在该模型内把 Antigravity 的内置
Gateway 从 v0.30 单一 `post_message` 提升到 v0.31 完整十三工具对等；v0.32 再按
[ADR-0091](adr/0091-durable-member-calls-and-single-slot-a2a-resume.md) breaking rename 为
`call_member`，并把 Attested Team Protocol 升至 3、Alias Map 升至 2。

## 当前正式接入

| Runtime | 验证版本 | 协议与 MCP 证据 | 认证 / 恢复证据 | 当前结论 |
|---|---:|---|---|---|
| Kiro CLI | 2.15.0 | ACP v1；私有 Custom Agent 设置 `includeMcpJson: false`；实测仓库 ambient MCP 未启动、ACP `mcpServers` 注入项成功初始化 | 2026-07-29 使用已登录账号完成真实模型 turn；跨进程 `session/load` 成功；`session/cancel` 返回 `cancelled`；`session/set_model` 成功；私有 `KIRO_HOME` 不丢失登录 | v0.19 接入；生产使用私有 Agent 启动目录，保留原生持久 Session |
| Qoder CLI | 1.1.7 | `--acp --strict-mcp-config`；私有 MCP 文件与 server allowlist 参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |
| CodeBuddy | 2.128.0 | `--acp --strict-mcp-config`；私有 MCP 文件参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |
| Qwen Code | 0.21.0 | `--acp`；私有 MCP 文件、server allowlist 与空集合 safe mode 参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |

## 现有 Antigravity Runtime 专项复核

Antigravity 已在产品目录中用于普通 AgentRun，也可以作为 A2A 接收目标；下表只复核发送侧
Team Gateway，不把它误列为“尚未接入的 Runtime”。

| 复核日期 / 版本 | 已观察证据 | 当前实现结论 | 仍需复核的边界 |
|---|---|---|---|
| 2026-08-01 / `agy 1.1.9`（v0.30 历史证据） | 专属 Plugin 可启动无凭据 MCP；Bridge 是 `agy` 直接子进程；macOS kernel peer PID/start/parent/path 可读取；当时的精确 `mcp(rovai_team/post_message)` 在真实 headless model call 生效；调用 `_meta` 有稳定 conversation/progress identity；Bridge 崩溃后 `agy` 不重启；真实 A→B→A 与普通终端负例通过 | 证明 Attested Bridge 拓扑与无凭据进程绑定可行，不证明 v0.32 `call_member` 协议 | 该历史证据自身不能证明新 alias、Schema、Return Obligation、Outcome 或自动 Resume；v0.32 复核见下方，不能改写本行冒充新协议实测 |
| 2026-08-02 / `agy 1.1.9`（v0.31 历史证据） | packaged Core 上真实模型依次完成 13 个 canonical Team/Context/Memory tool receipt、A2A leaf、Task version 2、Context Summary、1 个 Memory Revision、1 个 pending Hearth proposal 与 Core restart 无重复；普通 `agy` 的 `tools/list` 为空、13 个 direct call 全为 `run_not_bound`、领域写入为零；同一 Core 上 Codex `0.146.0` 与 OpenCode `1.18.5` 的十三工具回归通过。修复配置的 CAL-001 又真实完成 Context/Memory/Task/Team reply、文件编辑与测试，四角色以 7 AgentRun / 6 A2A 在原预算内收敛 | 增加 `BuiltInMcpToolParity::Complete`；十三条 exact permission bundle、catalog/protocol/Schema/Session compatibility 与统一 Core handler 已落地。AGY execution/attachment workspace、Prepared Binding 授权、非交互权限和 final-output 结算已修复；Qualification 显式使用 per-run skip-permissions。该结论只表示内置工具运输与语义对等，不提升 External MCP，也不改变 `PreservedUncontrolled` | 原始 `delivery_unknown` 有效失败仍保留；修复后校准为 valid pass，但十二次自主 Trial 尚未运行。`sandbox=on` 与 auto-approved bypass 不是严格安全隔离。上游 CLI、模型、Plugin/权限格式或父子进程行为变化后仍须整套复核 |
| 2026-08-02–03 / `agy 1.1.9`、Codex CLI `0.146.0`、OpenCode `1.18.5`（v0.32） | 新 `call_member` Schema 分别在真实 Codex→Codex 与 AGY→AGY Smoke 上完成 A→B→A；重启后无重复物化。普通未绑定 AGY 的 `tools/list` 为空，13 次直接调用均为 `run_not_bound`。随后 Team Pack revision 4 校准通过，12 个正式 Trial 共观察到 72 Run、60 Member Call、30 显式 Return、30 completed Task；12/12 协作审计、12/12 同成员单槽、0 轮询，4 个 Trial 直接捕获忙时 pending Input | v0.32 breaking alias、持久 Input、显式 Return、忙时 FIFO、自动 Resume、Attested Protocol 3 与 Alias Map 2 已获得跨三种 Runtime 的正式执行证据。OpenCode 使用 `opencode/big-pickle`；此前 `north-mini-code-free` 的真实 Spike 漏掉 Task、测试和返回，不再作为默认 tester | safe Core Outcome 和 pre-materialization Outcome 已由事务/集成测试覆盖；本轮正式 Trial 全走显式 Return，仍需专门的真实 Outcome/重启 Case。正式 Pass Rate 4/12，功能 6/12、边界 10/12、协作 12/12；协议可用不代表最终业务整合稳定。`sandbox=on` 与正式 Runner 的 skip-permissions 仍不构成严格安全隔离 |

前两条是 v0.30/v0.31 历史协议证据，第三条才是 v0.32 breaking protocol 的真实 Runtime
复核。编译、单元/集成测试和静态契约仍不能替代这条实测；反过来，一次真实显式 return
链路也不能替代 Outcome、取消、容量与 crash 分支的确定性测试。

这些证据不证明最终 MCP 集合唯一；实现明确保留用户 ambient MCP，并在状态中披露
`PreservedUncontrolled`。Plugin、用户级或 workspace 的同名 `rovai_team` 由启动前冲突检测
失败关闭，不依赖未证明的来源优先级。单工具历史验收见
[v0.30](versions/v0.30/README.md)，完整十三工具与 Qualification 结果见
[v0.31](versions/v0.31/README.md)。

## 已调研但未进入产品目录

这些名称不应出现在 `AdapterKind`、数据库 kind、Contracts、设置选项或运行时健康目录。

| Runtime | 调研版本 / 状态 | 观察结果 | 未接入原因 | 复核条件 |
|---|---:|---|---|---|
| Kimi CLI | 0.29.2 | ACP 可初始化；调用方 `mcpServers` 会与用户、项目、项目本地及插件 MCP 合并 | 当前版本只接入已验证精确 MCP 的新增 Runtime | 上游提供可验证的严格替换入口，或后续版本明确实现并披露“注入后保留原生配置”的准入 |
| Grok CLI | 0.2.112；本机未登录 | ACP 可初始化；初始化阶段可观察到个人 MCP，未发现严格替换入口 | 缺少登录后的完整 Session 证据，且不满足当前精确 MCP 门槛 | 完成登录、真实 turn、恢复/取消与 MCP 行为复核；或后续版本明确采用较弱准入 |
| Cursor Agent | 2025.09.18-7ae6800 | 支持 headless 与 resume；已验证入口会读取项目 `.cursor/mcp.json`，未发现每 Run 私有严格替换入口 | 不满足当前精确 MCP 门槛 | 上游提供私有 MCP 注入/替换合同，或后续版本明确采用较弱准入 |
| TRAE | CLI 未公开；App 可用 | 官方 Enterprise 页面仍将 CLI 标为 coming soon；App 诊断日志会记录继承的进程环境，不适合作为当前 AgentRun 隔离入口 | 没有公开稳定 CLI/协议；App 自动化与凭据/环境边界尚无可接受合同 | 官方发布可脚本化协议并完成环境、认证、Session、取消和 MCP 隔离复核 |

## 后续准入规则

- 新增 Runtime 的外部 MCP 准入仍以 `ExactPerRun` 为门槛；`AttestedNativeBridge` 只为满足
  ADR-0088 证据的 Runtime 挂接内部 Team Gateway，不提升外部 MCP 能力。
- preserved-ambient 路径只允许挂接内部 Team Gateway。版本状态、Run 冻结和
  审计必须分别说明外部 MCP Unsupported、Team attachment 方式与 ambient isolation；运行中
  不得静默改用其他策略。
- 这一新路径不能用于投影外部 MCP Library Assignment；Runtime 有 Assignment 但不能精确
  投影时必须在发送准入失败关闭。
- 已准入 Runtime 可以担任 Lead；兼容性差异不进入角色系统。
- 不能注入 Rovai MCP 的 Runtime 暂不考虑接入。

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
