---
document_type: version-architecture
version: v0.20
lifecycle: historical
authority: version-design
last_updated: 2026-07-29
---

# Rovai-ai v0.20 架构设计

> 版本范围：[README.md](README.md)
>
> 跨版本约束：
> [ADR-0066](decisions.md#adr-0066) ·
> [ADR-0065](../v0.19/decisions.md#adr-0065) ·
> [ADR-0007](../v0.03/decisions.md#adr-0007) ·
> [ADR-0062](../v0.17/decisions.md#adr-0062)

## 1. 三个相互独立的身份与证据层

```text
Product Runtime Catalog (编译时，9 项)
           │
           ├── Runtime Discovery Observation（本机快速观察，可重建）
           │
           └── Managed Default Installation（持久稳定身份）
                         │
                         ├── latest successful Capability Snapshot
                         ├── latest Probe Attempt / retry backoff
                         └── verified relocation audit

AgentProfile
  └── Product Runtime Selection(adapterKind, model/permission resolution)
                         │
                         └── ordinary resolution → managed Installation
```

Catalog 回答“Rovai 支持什么”，Discovery 回答“当前搜索环境看到什么”，Installation
回答“普通选择稳定引用哪一个经过验证的本机入口”。三者不得再由一个 health payload
兼任。

当前目录固定为：

```text
codex-cli       opencode-cli       copilot-cli
claude-code-cli antigravity-app    kiro-cli
qoder-cli       codebuddy-cli      qwen-code
```

## 2. Runtime Search Environment

Core 使用同步 bootstrap：

```text
sync main
  ├── team-mcp-bridge 子命令直接进入专用路径
  ├── capture inherited PATH
  ├── bounded $SHELL -lc framed PATH
  ├── append macOS known locations
  ├── normalize + dedupe + provenance
  └── create Tokio Runtime → async Core
```

Search Environment 是 `Arc` 指向的不可变 snapshot：

```rust
struct RuntimeSearchEnvironment {
    generation: u64,
    path_entries: Vec<SearchPathEntry>,
    inherited_path: OsString,
    shell: ShellPathObservation,
    created_at: Timestamp,
}
```

每个 Runtime 子进程都显式设置由 snapshot 生成的 `PATH`。不得调用
`std::env::set_var("PATH", ...)`。显式 rescan 构造下一 generation 并通过单写多读容器
原子替换；已运行进程继续持有旧 snapshot。

自动 Shell 命令只输出随机标记包围的 PATH，三秒后终止完整进程组，stdin 为 null，
stdout 有界读取，stderr 丢弃。日志只记录 shell 类型、结果分类、耗时和 PATH entry 数，
不记录完整 PATH 或其他环境。

macOS 已知目录包括：

```text
~/.local/bin
~/.npm-global/bin
~/.volta/bin
~/.cargo/bin
~/go/bin
~/.deno/bin
~/.nvm/versions/node/*/bin
pnpm global bin（`PNPM_HOME`、`~/Library/pnpm`、`~/.local/share/pnpm`）
/opt/homebrew/bin
/usr/local/bin
```

动态目录在构建 snapshot 时展开；不存在的目录不成为候选。

## 3. 快速发现流水线

每个 Adapter 提供命令名、环境 override、可选版本参数和已知位置。启动后九项并行：

```text
candidate paths by source priority
  → canonical path + executable bit
  → fingerprint
  → publish found_uninspected immediately
  → bounded optional version command
  → publish reportedVersion without changing discovery authority
```

Observation 的最小合同：

```ts
type RuntimeDiscoveryObservation = {
  runtimeKind: AdapterKind;
  discoveryStatus: "detecting" | "found" | "missing";
  executablePath: string | null;
  source: "env" | "inherited_path" | "login_shell" | "known_location" | "manual" | null;
  fingerprint: string | null;
  reportedVersion: string | null;
  searchGeneration: number;
  observedAt: string;
  diagnosticCode: string | null;
};
```

发现不写 Installation，也不执行 ACP、认证或 Session。Renderer 订阅 observation delta；
进入成员页不触发 discovery。

## 4. 深度探测与证据状态机

深度探测沿用 Adapter 自己的协议与 disposable Session，但输入必须包含候选路径、
fingerprint 和 Search Environment generation。成功事务写入新的 Capability Snapshot；
无论成功失败都追加/更新 Probe Attempt。

```text
                          successful probe
found_uninspected ───────────────────────────► ready
       │                                          │
       ├── auth rejected ─► authentication_required
       ├── capability/protocol mismatch ─► incompatible
       └── timeout/io/network ─► retryable failure

ready + age > 24h ─► refresh_due ─► background checking
  ├── success: replace successful snapshot
  ├── transient failure: keep ready + warning + backoff
  └── hard identity/safety failure: block; retain old snapshot only for diagnostics
```

`lastSuccessfulProbeAt` 只在成功时更新。`lastAttemptAt`、`failureClass`、
`retryAfter` 和安全诊断独立存储。被停用 Installation 不进入后台 probe 队列。

## 5. Managed Default Installation 与成员投影

普通成员配置不保存路径：

```ts
type ProductRuntimeSelection = {
  adapterKind: AdapterKind;
  modelSelection: "pending" | "runtime_default" | { modelId: string };
  permissionValues: "pending" | Record<string, string>;
  schemaDigest: string | null;
};
```

每个 `(adapterKind, authScope)` 由唯一 managed default 解析。自定义 wrapper 使用
`installationClass = "custom"`，不参与普通自动选择。成员投影为：

```text
not_selected
selected_unresolved
configuration_incomplete
needs_attention
ready
```

解析器只从真实 Snapshot 读取模型与权限 schema。`runtime_default` 可以自动选择；权限
自动值必须在 Adapter 的 reviewed-safe allowlist 内。缺少安全值时不猜测。

## 6. 自动登记与 Verified Relocation

用户选择未解析产品或已登记入口丢失时，共用同一 Resolution service：

```text
same Adapter + authScope + commandName candidates
  → lightweight validation
  → deep probe in quarantine
  → first fully ready candidate
  → transaction:
       preserve installationId
       update canonical path/source/fingerprint
       increment installation generation/version
       write successful snapshot
       write relocation audit
       resolve matching Product Runtime selections
```

若尚无 managed default，则事务创建一个；若已有，则原位更新。所有候选失败时保留旧
Installation 和选择，状态为 path missing / selected unresolved。迁移审计只保存规范路径、
来源、旧/新 fingerprint、版本、时间、结果码，不保存 CLI 原始输出。

## 7. Run 准入与持久 Pending Intent

发送 API 使用稳定 request ID 去重：

```text
Send(requestId)
  ├── runtime usable ─► atomic message + turn + frozen run
  └── runtime unresolved/hard stale
        └── persist PendingExecutionIntent + RuntimeResolutionJob
              ├── success ─► consume intent atomically and create run
              ├── failure ─► keep intent/draft retryable; create no public artifacts
              └── cancel ─► terminal cancelled; create no public artifacts
```

Core 重启从非终态 intent 恢复。输入有明确大小上限，并复用现有消息安全验证。最终冻结的
AgentRun 仍保存实际 Installation ID、路径、版本、fingerprint、模型、权限、能力与 Search
Environment generation；冻结后永不被 relocation 改写。

## 8. Native Session compatibility

Capability Snapshot 可带 `nativeSessionCompatibilityKey`。已知相同 key 可复用；已知不同
则新建；任一侧未知时允许一次 pre-input controlled resume：

```text
new binding generation + fence
  → resume/load only, no user input or tools
  ├── verifiable success: bind Session, then deliver input
  └── not found / explicit incompatible / timeout / ambiguous:
       kill and fence host → create fresh Session → deliver portable context
```

尝试以 `(conversationId, installationId, installationGeneration)` 唯一约束。旧 generation
事件无法写 marker 或完成新 Run。路径和版本只参与 Host 配置与审计，不等同于 Session
兼容性。

## 9. Desktop 投影

成员页的选择器输入是 Catalog 与 member projection，不再 filter `executablePath`。每项
显示产品名称和以下中文状态：

- 正在检测
- 未找到
- 已找到，尚未检查
- 正在检查
- 已就绪
- 需要登录
- 版本或能力不兼容
- 路径失效
- 已停用
- 刷新失败，仍使用上次成功检查

Runtime 设置页提供“检查可用性”和“重新检测全部”。未找到项可打开安装说明；普通流程
不打开文件选择器。高级诊断才显示路径、来源、fingerprint、最近探测、退避、迁移审计和
“添加自定义启动入口”。

## 10. 数据与演进

v0.20 增加干净的 Runtime schema，替换旧路径型成员 preference 和 snapshot/attempt
混合语义。由于产品未发布，不实现旧 Runtime 数据回填、重复 Installation 合并或旧
preference 兼容读取；开发环境升级时允许重建数据库。非 Runtime 领域的既有 Migration
与数据语义不在本版本范围内。
