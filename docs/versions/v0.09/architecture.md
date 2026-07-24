---
document_type: version-architecture
version: v0.09
lifecycle: current
authority: version-architecture-and-protocol
last_updated: 2026-07-24
---

# Lumen AI v0.09 MCP Library 架构与协议

> 状态：实施中（Runtime 原生注入已完成）
>
> 版本范围：[README.md](README.md)
>
> 跨版本边界：
> [ADR-0018](../../adr/0018-file-backed-mcp-library-runtime-projection.md)
>
> 相关约束：
> [ADR-0009](../../adr/0009-reproducible-context-delivery.md)、
> [ADR-0014](../../adr/0014-stable-team-tool-gateway-v2.md)、
> [ADR-0015](../../adr/0015-action-safety-v2.md)、
> [ADR-0016](../../adr/0016-multi-runtime-execution-v2.md)

## 1. 目标与非目标

v0.09 在设置页增加“MCP”，让用户用一份 Lumen 本地配置管理外部 MCP Server，
按成员决定可用范围，并由 `AgentRuntimeAdapter` 在每个 AgentRun 启动时翻译为
Runtime 原生配置。

本版本必须满足：

- `~/.lumen/mcp.json` 是唯一配置真源；
- 不预装或默认启用任何第三方 MCP；
- 可从六种已知用户级 Agent 配置一次性导入；
- 不修改、监听或持续同步来源 Agent 配置；
- 外部 MCP 按 AgentProfile 显式分配；
- 每个 AgentRun 冻结实际使用的 MCP 清单和私有 Runtime Projection；
- MCP 配置变化不更换 Conversation 或 Native Session；
- Team MCP 始终追加存在，且不进入用户 MCP Library；
- Runtime 个人 MCP 不能绕过 Lumen 的成员分配；
- 不对不具备逐轮注入能力的 Adapter 伪造支持。

v0.09 不实现：

- 在线 MCP Registry、商店搜索、推荐榜或远程安装目录；
- 默认 Context7 或其他 Bundled MCP；
- 项目级、Camp 级或 Task 级 MCP Scope；
- OAuth 登录、Callback、Token 刷新或 Credential Broker；
- 跨 Runtime 的单 Tool Allowlist/Denylist；
- 独立 MCP Client、Tool Catalog、连接测试或后台健康轮询；
- 通用 MCP Proxy；
- 对 Runtime 无法暴露的审批能力作统一安全承诺；
- 向任何 Runtime 用户级或项目级配置文件回写。

## 2. 术语与不变量

```text
MCP Configuration File
    ~/.lumen/mcp.json，外部 MCP 配置唯一真源。

MCP Server Definition
    一项强类型 Stdio 或 Streamable HTTP 配置。

MCP Assignment
    一个 Server 对一个 AgentProfile 的显式可用关系。

MCP Import Candidate
    从其他 Agent 用户级配置只读发现的临时候选。

MCP Exposure Snapshot
    一个 AgentRun 实际解析出的不可变外部 MCP 清单。

MCP Runtime Projection
    Adapter 为一次 AgentRun 生成的 Runtime 原生私有配置。
```

固定不变量：

```text
MCP Server Definition != MCP Runtime Projection
MCP Assignment != CampMember
MCP Import Candidate != MCP Server Definition
External MCP != Team MCP
Agent Host != Native Session
```

- Server Name 在 Lumen MCP Library 内唯一。
- `enabled = true` 但没有 Assignment 时，不向任何 Agent 暴露。
- Assignment 只表示目标可用范围，不证明 Adapter 支持或连接成功。
- Exposure Snapshot 只在 AgentRun 边界变化，不在运行中热切换。
- Runtime Projection 可以包含凭据，但不是用户配置真源。
- Native Session 连续性不依赖 MCP 配置摘要。
- Team MCP 的保留名称 `lumen_team` 不允许被外部 Server 使用。

## 3. 配置文件

### 3.1 路径与权限

唯一真源：

```text
~/.lumen/mcp.json
```

- 首次读取且文件不存在时，返回空配置，不因为打开页面立即创建文件。
- 第一次成功添加或导入后创建 `~/.lumen` 与文件。
- 目录权限应为 `0700`，文件权限应为 `0600`。
- 写入使用同目录临时文件、`fsync`、Atomic Rename。
- 任一步失败时保留原文件；不能以空对象替换损坏或不可读配置。
- Core 测试使用显式注入的配置路径，不依赖真实用户 Home。

### 3.2 Schema v1

```json
{
  "schemaVersion": 1,
  "mcpServers": {
    "context7": {
      "enabled": true,
      "agentProfileIds": ["agent-muwa"],
      "transport": "streamable_http",
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}"
      }
    },
    "local-docs": {
      "enabled": true,
      "agentProfileIds": ["agent-luoke", "agent-muwa"],
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@example/docs-mcp"],
      "cwd": null,
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

对应类型：

```ts
type McpConfigFile = {
  schemaVersion: 1;
  mcpServers: Record<string, McpServerDefinition>;
};

type McpServerBase = {
  enabled: boolean;
  agentProfileIds: string[];
  missingValues?: string[];
};

type McpStdioServer = McpServerBase & {
  transport: "stdio";
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
};

type McpHttpServer = McpServerBase & {
  transport: "streamable_http";
  url: string;
  headers: Record<string, string>;
};
```

Schema 规则：

- 顶层和 Server Entry 使用严格字段集合；未知字段产生配置错误，防止 UI 重写时
  静默丢失用户内容。
- Server Name 使用可跨 Runtime 翻译的子集：
  `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`。
- `lumen_team` 是保留名称。
- `agentProfileIds` 去重并按稳定顺序写回；未知或已归档 ID 产生局部警告并在运行时
  忽略，不使整个文件不可解析。
- Stdio Command、Argument、Env Key/Value 必须是字符串；Command 不允许为空。
- `cwd = null` 表示 AgentRun execution root；相对路径也相对 execution root 解析；
  绝对路径保持原义并继续受 Runtime 权限限制。
- HTTP URL 只允许 `http` 或 `https`；Header 名和值不得包含 CR/LF。
- v0.09 不接受 `sse`、OAuth、Tool Filter 或任意 Runtime 专属字段。
- `missingValues` 只用于记录导入时被遮罩、尚未由用户重新填写的 Env/Header
  字段名；存在该字段时 Server 必须保持禁用。它不保存来源值，也不会进入
  Runtime Projection。

### 3.3 环境变量引用

普通值与 `${ENV_VAR}` 可以同时存在。Lumen 在生成 Runtime Projection 时解析引用：

- 只从 Lumen Agent Host 本轮可见的环境读取；
- 缺少任一引用时，该 Server 对本轮标记 `missing_environment` 并不暴露；
- 不回写解析后的值到 `mcp.json`；
- Exposure Snapshot 只记录变量名和脱敏摘要，不记录解析值；
- Runtime Projection 可以包含解析值，文件权限必须是 `0600`。

v0.09 不读取 Shell Profile 来模拟 Finder 未继承的环境。用户可以在 UI 中保存普通
本地值，或用正常方式为 Lumen 进程提供环境变量。

### 3.4 读取、外部编辑与并发写

Core 不长期缓存 `mcp.json`。以下边界重新读取：

- MCP 设置页加载或窗口重新获得焦点；
- 添加、编辑、启停、删除或导入前；
- AgentRun 首次物化 Exposure Snapshot 时。

每次成功读取返回 `configDigest`。所有 UI 写操作携带 `expectedConfigDigest`：

```text
当前文件 Digest == expectedConfigDigest
    → 校验并原子写入，返回新 Digest

不相等
    → mcp.config_conflict，Renderer 重新加载
```

文件不存在具有固定 Empty Digest。写操作本身保持语义幂等：

- 创建同名同配置返回当前结果；
- 设置为已有启用值返回成功；
- 删除不存在名称返回成功；
- 同一 Import 重复执行遵循 MCP-11 去重规则。

解析失败时：

- 设置页显示文件路径、行列和错误；
- 所有 UI Mutation 禁止写回；
- 新 AgentRun Fail Closed：不暴露任何外部 MCP，但 Team MCP 和普通 Agent 能力
  继续可用，并记录 `mcp_config_invalid` Warning；
- 不复用内存中的 Last Known Good 外部 MCP，避免用户已尝试撤销的能力继续存在。

## 4. Import 协议

### 4.1 来源

只读取用户级配置：

| Source Kind | 路径或入口 | 读取范围 |
|---|---|---|
| `codex` | `$CODEX_HOME/config.toml` 或 `~/.codex/config.toml` | `[mcp_servers.*]` |
| `claude_code` | `~/.claude.json`，并兼容已存在的 `~/.claude/mcp.json` | 顶层 `mcpServers` |
| `opencode` | `$OPENCODE_CONFIG` 或 XDG `opencode.json(c)` | 顶层 `mcp` |
| `copilot` | `$COPILOT_HOME/mcp-config.json` 或默认路径 | `mcpServers` |
| `antigravity` | `~/.gemini/config/mcp_config.json` | `mcpServers` |
| `cursor` | `~/.cursor/mcp.json` | `mcpServers` |

不扫描项目目录，不读取 Claude Code 的 Project Local Record，不递归搜索磁盘。
Importer 失败按来源隔离。

### 4.2 两阶段导入

```text
Scan
→ Parse
→ Normalize
→ Redact
→ Compare with mcp.json
→ Return Candidates

User reviews/edits candidates
→ Commit with expectedConfigDigest
→ Atomic write
```

Candidate 至少包含：

```ts
type McpImportCandidate = {
  candidateId: string;
  sourceKind: string;
  sourcePath: string;
  sourceName: string;
  proposedName: string;
  normalizedDefinition: McpTransportDefinition | null;
  sourceEnabled: boolean | null;
  compatibility: "portable" | "needs_input" | "unsupported";
  issues: McpImportIssue[];
  conflict: "none" | "same" | "name_conflict" | "duplicate_definition";
};
```

- Candidate ID 由来源种类、规范化来源路径、名称与脱敏定义摘要确定。
- Scan 不创建文件、不写事件、不执行命令或网络访问。
- Import 默认分配给当时全部活跃 AgentProfile。
- 用户可以在 Commit 前改变名称、启用状态、成员与被遮罩字段。
- 可移植且字段完整的 Candidate 默认启用。
- 仍缺少被遮罩字段的 Candidate 只能保存为禁用，或由用户补齐后启用。

### 4.3 凭据与不可移植字段

- `${ENV_VAR}` 引用保留。
- 来源中的 Env/Header 普通值全部视为潜在秘密，不回传明文到 Renderer；
  Candidate 只返回字段名和 `redacted_value` Issue。
- OAuth、Credential Cache、Cookie、Token Store 不读取。
- Legacy SSE 标记 `unsupported_transport`，不能 Commit。
- 限制性 Tool Filter 标记 `nonportable_tool_filter`，默认不选择；用户明确确认
  “按全部工具导入”后才能移除该 Issue。
- Runtime 专属字段如果影响连接或权限，标记不可移植，不能静默丢弃。

### 4.4 冲突

- 同名同定义：幂等跳过。
- 同名不同定义：必须选择 Replace、Rename 或 Skip。
- Replace 只替换 Transport Definition，保留现有 Enabled 与 Assignments。
- 不同名同定义：默认 Skip，用户可保留别名。
- 来源元数据不写入长期配置，不建立同步身份。

## 5. Exposure 与恢复

### 5.1 解析

AgentRun 首次启动时按以下顺序解析：

```text
读取并校验 mcp.json
→ 选择 enabled Server
→ 按 agentProfileIds 过滤
→ 校验 Adapter Projection Capability
→ 解析环境变量与 cwd
→ 合并固定 Team MCP
→ 生成 Exposure Snapshot
→ 生成 Runtime Projection
→ 持久化脱敏 Manifest 与摘要
→ 启动 Agent Runtime
```

Exposure Entry：

```ts
type McpExposureEntry = {
  name: string;
  transport: "stdio" | "streamable_http";
  configDigest: string;
  status:
    | "ready"
    | "disabled"
    | "unassigned"
    | "adapter_unsupported"
    | "missing_environment"
    | "invalid";
  reason: string | null;
};
```

Context Manifest 增加：

```ts
mcpExposure: {
  schemaVersion: 1;
  configDigest: string;
  servers: McpExposureEntry[];
};
mcpExposureDigest: string;
```

Manifest 不记录 Env/Header 值。Context Inspector 可以展示 Server 名、Transport、
适配结果与 Digest，但不能展示秘密。

### 5.2 私有 Runtime Projection

私有文件使用确定性目录：

```text
<Core data_dir>/runtime/mcp/
└── <agent-run-id>/
    └── <execution-epoch>/
        ├── canonical.json
        └── <adapter-native files>
```

- 目录 `0700`，文件 `0600`。
- 先完整写入临时目录，再 Atomic Rename 发布。
- 同一个 AgentRun/Execution Epoch 的 Projection 内容不可变。
- 恢复时验证 Manifest Digest、Canonical Digest 与文件权限。
- Run 终态后最佳努力删除；启动和周期清理只删除已确认终态或无对应 Run 的目录。
- Projection 丢失或摘要不一致时原 Run 失败为 `mcp_projection_unavailable`。

### 5.3 Session 语义

- 当前 Run 不热切换。
- 后续 Run 读取当前配置。
- Conversation 与 Native Session ID 保持不变。
- Adapter 可以重启或隔离 Agent Host 以应用新 Projection。
- Adapter 不能在 Resume 时安全应用新配置，则该 Server 状态为
  `adapter_unsupported`；不能继续泄露旧配置。

## 6. Adapter 投影

Adapter Registry 增加：

```ts
type McpProjectionCapability = {
  supportsStdio: boolean;
  supportsStreamableHttp: boolean;
  isolation: "exact_per_run" | "unsupported";
  approvalControl:
    | "lumen_interceptable"
    | "runtime_native"
    | "unsupported";
};
```

### Codex CLI

- 当前主路径使用 Codex App Server Thread Config。
- 向 Thread Start/Resume 注入完整 `mcp_servers` 配置，不依赖用户个人 MCP。
- Exec Fallback 使用 `--config`/等价结构化覆盖。
- Team MCP 作为保留 Entry 追加。
- 必须用真实本机版本验证个人 MCP 不会在隔离模式下泄露。

### Claude Code CLI

- 为本轮生成合并后的临时 `mcpServers` JSON。
- 同时传入 `--mcp-config <file>` 与 `--strict-mcp-config`。
- Resume 原 Session，不替换 System Prompt；Charter 仍只在新 Session 追加。
- Adapter 原生 `--allowedTools`/Permission Mode 继续控制调用权限。

### OpenCode CLI

- 通过 ACP `session/new` 或 `session/load` 的 `mcpServers` 注入完整列表。
- Agent Host 使用隔离配置，不能从全局 OpenCode Config 合并未分配 MCP。
- Team MCP 与外部 MCP 进入同一 ACP Session 配置。

### GitHub Copilot CLI

- 使用本轮私有 `--additional-mcp-config @<file>`。
- 禁用 Built-in MCP，并隔离 `~/.copilot/mcp-config.json`、Plugin MCP 与其他
  未分配来源。
- 只为本轮 External Server 和 Team MCP 生成可见/允许参数。
- Resume 原 Session。

### Antigravity App

- `agy 1.1.6` 没有已验证的逐轮 MCP 配置参数。
- v0.09 Capability 为 `unsupported`。
- 不修改 `~/.gemini/config/mcp_config.json` 或项目 `.agents/mcp_config.json`。
- Importer 仍可读取 Antigravity 用户级配置，供其他成员使用。

Adapter 验证必须基于运行时 Probe 和真实 Smoke，不固定版本 Allowlist。

## 7. 权限与审计

- 第三方 MCP 由 Agent CLI 调用，不通过 Lumen 通用 Proxy。
- Adapter 能提供执行前授权回调时，继续进入 ADR-0015 Action/Approval。
- 不能提供可靠回调时，遵循 AgentProfile 的 Adapter 原生权限配置。
- 设置页按成员展示：
  `Lumen 可拦截`、`Runtime 原生控制`、`当前不支持`。
- Runtime Event 可记录 Server、Tool、状态、耗时和脱敏摘要；不得把 Header、
  Env、Token 或未受控 Tool Output 写入诊断。
- 观察到调用不等于 Core 已批准；Audit 文案必须区分。
- Team MCP 始终遵循 ADR-0014 的 Capability、Binding 与 Epoch Fencing。

## 8. Core API

只读：

```text
mcp.config.get
mcp.import.scan
mcp.compatibility.get
```

写入：

```text
mcp.servers.create
mcp.servers.update
mcp.servers.setEnabled
mcp.servers.delete
mcp.import.commit
```

Electron Main：

```text
mcp.config.reveal
```

公共响应：

```ts
type McpConfigView = {
  path: string;
  exists: boolean;
  configDigest: string;
  servers: McpServerView[];
  fileIssue: McpConfigIssue | null;
};

type McpMutationResult =
  | { status: "ok"; configDigest: string; config: McpConfigView }
  | { status: "conflict"; actualConfigDigest: string }
  | { status: "invalid"; issues: McpConfigIssue[] };
```

- Renderer 不直接读写文件。
- API 返回值全部脱敏。
- Import Scan 不通过通用 DomainCommandGateway，因为它无业务状态变化。
- 文件 Mutation 使用 Digest CAS 和语义幂等，不新增 SQLite CommandRecord。
- 成功写入后 Core 发出非持久化 `mcp.config.changed` Event 使 Renderer 刷新；
  文件本身仍是恢复真源。

## 9. Renderer

设置导航顺序：

```text
成员
技能
MCP
外观
诊断
```

页面结构：

- Header：说明、添加 MCP、从本机 Agent 导入、打开配置文件。
- 主列表：启用开关、名称、Transport、成员摘要、兼容性和行操作。
- Add/Edit Dialog：结构化字段与成员多选。
- Import Dialog：按来源分组的候选、Issue、冲突选择和成员选择。
- File Error Banner：路径、行列、重新读取、打开文件。
- Empty State：没有默认 Server；提供添加与导入两个入口。

删除是硬删除配置 Entry，不提供归档或搜索。正在运行的 AgentRun 使用自己的私有
Projection；删除只影响后续 Run。

Day/Night 使用同一信息架构与状态；连接配置是工程表单，不增加卡片墙或故事装饰。

## 10. 恢复与失败语义

| 情况 | 行为 |
|---|---|
| `mcp.json` 不存在 | 空 Library；AgentRun 只有 Team MCP |
| 文件语法错误 | UI 报错；外部 MCP Fail Closed；不覆盖文件 |
| 文件权限过宽 | 警告并允许用户修复；不把秘密写入诊断 |
| 外部编辑与 UI 冲突 | CAS 拒绝，Reload 后重试 |
| 单个 Server 语义错误 | 文件错误；不部分猜测并重写 |
| 未知 AgentProfile ID | 局部警告并忽略该 Assignment |
| Env 引用缺失 | 本轮该 Server 不暴露；Run 继续 |
| Adapter 不支持 | 本轮该 Server 不暴露；UI/Manifest 可见 |
| Runtime 连接失败 | 对应 AgentRun Runtime 错误 |
| Projection 发布中崩溃 | 清理未发布临时目录；原文件不受影响 |
| 已发布 Projection 丢失 | 原 Run 失败，不用新配置替代 |
| 删除 Server 时 Run 正在执行 | Run 继续使用冻结 Projection；新 Run 不暴露 |

## 11. 数据与迁移

- 不增加 MCP Server/Assignment SQLite 表。
- Context Manifest 增加 MCP Exposure 字段，使用新 Migration。
- 老数据库字段使用空 Exposure 默认值。
- `mcp.json` 初始不存在；不迁移 Runtime 用户配置，只有用户确认 Import 才写入。
- v0.09 尚处开发期；错误实验 Schema 可以通过明确 Migration/本地测试数据重置
  清理，不保留双写兼容层。
