---
document_type: version-architecture
version: v0.19
lifecycle: current
authority: version-design
last_updated: 2026-07-29
---

# Rovai-ai v0.19 架构设计

> 版本范围：[README.md](README.md)
>
> 跨版本约束：
> [ADR-0065](../../adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md) ·
> [ADR-0017](../../adr/0017-managed-skill-library-runtime-projection.md) ·
> [ADR-0018](../../adr/0018-file-backed-mcp-library-runtime-projection.md)

## 1. 产品 Runtime 目录

产品目录只包含已经实现并能冻结 AgentRun 的 Adapter。当前 `AdapterKind` 封闭集合是：

```text
codex-cli       opencode-cli       copilot-cli
claude-code-cli antigravity-app    kiro-cli
qoder-cli       codebuddy-cli      qwen-code
```

新增候选的验证结论写入
[`docs/runtime-compatibility.md`](../../runtime-compatibility.md)，不先占用产品枚举、Migration
或 UI。Installation 的 Ready 仍取决于当前可执行文件 fingerprint、认证和能力 snapshot，
不是产品名称的静态属性。

```text
implemented Adapter
        │
        ▼
discover executable + fingerprint
        │
        ▼
isolated protocol + disposable Session probe
        │
        ├── exact MCP + required Session capabilities + auth ──► Ready
        │
        └── missing capability / auth / changed binary ────────► blocked
```

## 2. ACP 产品边界

OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code 共享 JSON-RPC/ACP transport，
但命令、权限与 MCP 隔离分别处理。

| Adapter | 启动入口 | 权限投影 | MCP 隔离 |
|---|---|---|---|
| Kiro | `acp --agent rovai` | ACP structured permission request | 私有 Custom Agent + Session `mcpServers`；模型使用 `session/set_model` |
| Qoder | `--acp --strict-mcp-config` | `permission_mode` | 私有 `mcpServers` 文件 + allowlist |
| CodeBuddy | `--acp --strict-mcp-config` | `permission_mode` | 私有 `mcpServers` 文件 |
| Qwen Code | `--acp` | `approval_mode` | 私有 `mcpServers` 文件 + allowlist |

### Kiro 的双目录启动

Kiro 需要同时保留登录和原生 Session，又不能从用户或项目 `mcp.json` 合并额外 MCP。
`AcpHost` 因而区分：

```text
process current_dir = Rovai private/acp-host/<uuid>
  └── .kiro/agents/rovai.json (includeMcpJson: false)

ACP session cwd = frozen AgentRun execution_root
ACP mcpServers  = frozen Team MCP + external MCP
```

只改变进程启动时的 Agent 发现目录，不设置生产 `KIRO_HOME`，所以认证和跨进程
`session/load` 继续使用 Kiro 原生持久存储。Host 退出后私有 Agent 目录删除；仓库和用户
全局配置不被改写。健康探测使用 disposable `KIRO_HOME` 避免留下探测 Session，但认证仍
来自本机安全存储。

### 严格配置文件 Adapter

Qoder、CodeBuddy、Qwen 的一次性配置由 Team Tool process configuration 创建并由
`AcpHost` 持有到进程退出，避免 Runtime 延迟读取时文件已删除。配置名称集合来自当前
Run 冻结的 Team MCP 与外部 MCP。

Qwen 的空 MCP 路径使用 safe mode；三种 Adapter 把旧 `read_only` 配置收敛为各自支持
的最小写入权限，不向 CLI 传不存在的通用权限值。

## 3. 健康探测与冻结

健康探测依次验证：

1. executable、版本和 fingerprint；
2. 使用生产隔离入口完成 ACP initialize；
3. 创建 disposable Session，验证认证和必需 Session 能力；
4. Adapter 的已验证 MCP 边界向 snapshot 提供 `mcp.exact_per_run`。

探测结果按 executable fingerprint 和 TTL 缓存；显式刷新绕过缓存。AgentRun 创建前按
当前 Installation 再解析，随后冻结 executable、协议、模型、权限、能力和配置 digest。
运行中不因新版探测结果静默重写旧 Run。

Kiro 的真实账号手工验收额外覆盖了 ambient MCP 排除、注入 MCP 初始化、跨进程 load、
模型 turn 和 cancel。真实健康 smoke 还验证 `session/set_model` 与可冻结模型目录；自动
测试固定私有 Agent JSON、启动参数和 Exact capability 映射。Kiro 当前不暴露通用
`session/set_config_option`，因此 v0.19 不向它冻结模型附加选项。

## 4. Migration v30

SQLite `adapter_installation.adapter_kind` 的封闭 CHECK 扩展为：

```text
codex-cli, opencode-cli, copilot-cli, claude-code-cli, antigravity-app,
kiro-cli, qoder-cli, codebuddy-cli, qwen-code
```

Migration v30 以建新表、复制、替换和 foreign key check 扩展集合；Installation ID、
路径、版本、能力 snapshot 和 AgentProfile 外键保持不变。

## 5. Skill、MCP 与角色

ADR-0017 的 Skill Library 仍是权威来源。四种新增 Runtime 在没有验证原生 Skill
发现合同时报告不支持，不伪造投影。

ADR-0018 的 MCP Library 继续拥有应用级定义与 Team membership。当前四种新增 Runtime
都只在 `mcp.exact_per_run` 成立时冻结。

Lead 是 Collaboration 角色，不从 Runtime MCP 兼容性推导。未来若版本明确接入保留原生
MCP 的 Runtime，它仍可担任 Lead；这一未来策略不在 v0.19 增加类型或执行分支。

## 6. Renderer 语言

面向用户继续使用“执行引擎”。Renderer 只展示实际实现的 Adapter 和当前 Installation
诊断；不会显示兼容性调研分类，也不会为未接入候选提供自定义路径入口。
