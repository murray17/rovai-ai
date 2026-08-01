---
document_type: development-guide
authority: test-command-routing
last_updated: 2026-07-30
---

# 测试与 Smoke Test

[`package.json#scripts`](../../package.json)是 JavaScript 命令名和组合的真源。Rust 测试
目标由 Cargo workspace 和测试代码决定。

## 测试层级

### 快速静态与单元验证

```bash
pnpm typecheck
pnpm test
cargo test --workspace
```

需要把 warning 作为失败或验证桌面构建时：

```bash
cargo clippy --workspace --all-targets -- -D warnings
pnpm build:desktop
```

### 非模型 Smoke

| 命令 | 主要范围 | 外部要求 |
| --- | --- | --- |
| `pnpm smoke:core` | 全新数据库、普通目录、空 Git 仓库、导航、重启和删除 | Git；不调用模型 |
| `pnpm smoke:member-config` | 九种产品目录、Installation、成员 Runtime 配置、Readiness 和重启 | 不调用模型；可用 `ROVAI_*_BIN` 覆盖发现 |
| `pnpm smoke:memory` | Memory Migration、治理、Revision、导出、投影恢复和权限 | 不调用模型 |

### 真实 Runtime Smoke

下表中的命令会调用本机 Runtime 和上游模型，可能产生费用、限流或授权弹窗。运行前确认
账户、模型和权限策略。

| 命令 | 默认或支持的 Runtime | 额外说明 |
| --- | --- | --- |
| `pnpm smoke:intake` | Codex | 创建 Git fixture；验证 Camp 消息、连续 Conversation、重启和删除 |
| `pnpm smoke:acp-runtime` | OpenCode + Copilot | `ROVAI_ACP_SMOKE_ADAPTER` 可选其中一个 |
| `pnpm smoke:claude-runtime` | Claude Code | 验证原生权限、连续性和 Resume |
| `pnpm smoke:antigravity-runtime` | Antigravity + Codex | 包含 Antigravity 到 Codex 换绑 |
| `pnpm smoke:action-approval` | Codex | 验证越界动作的 Approval 与唯一副作用 |
| `pnpm smoke:multi-agent` | Codex | 同一 CampTurn 的两个真实并发 AgentRun |
| `pnpm smoke:team-context` | Codex 默认；支持 OpenCode、Copilot、Claude Code、Antigravity | 用 source/target selector 选择；可开启 Task handoff |
| `pnpm smoke:antigravity-team` | Antigravity → Antigravity | 显式暂装无凭据 Plugin 与窄权限；验证 A→B→A、普通终端负例并按 exact identity 清理 |
| `pnpm smoke:team-tasks` | Codex 默认；支持 OpenCode、Copilot、Claude Code | 验证三个 Task Team Tool |
| `pnpm smoke:skills` | Codex 默认；suite 支持 Codex、OpenCode、Copilot、Claude Code、Antigravity | `all` 只表示这五个 suite-supported Runtime，不表示全部九种产品 |
| `pnpm smoke:mcp` | Codex、Claude Code、OpenCode、Copilot | 默认四种；逐 Run 临时 MCP 配置 |
| `pnpm smoke:memory-runtime` | Codex + Claude Code | 可只选一种；Claude 有 bounded model/budget 配置 |
| `pnpm smoke:recovery` | OpenCode 默认 | 可选择其他产品 Runtime；创建 Git fixture 并杀死 Core 验证恢复 |

`pnpm smoke:runtime-permissions` 是 `smoke:action-approval` 与
`smoke:multi-agent` 的聚合命令。

## 常用选择器

| 环境变量 | 使用者 |
| --- | --- |
| `ROVAI_ACP_SMOKE_ADAPTER` | `smoke:acp-runtime` |
| `ROVAI_TEAM_SOURCE_ADAPTER` / `ROVAI_TEAM_TARGET_ADAPTER` | Team context/task Smoke |
| `ROVAI_TEAM_TASK_HANDOFF=1` | Team context 的完整 Task 交接 |
| `ROVAI_SKILL_SMOKE_ADAPTERS` | Skill Runtime 列表或 `all` |
| `ROVAI_MCP_SMOKE_ADAPTERS` | MCP Runtime 列表 |
| `ROVAI_MEMORY_RUNTIME_ADAPTERS` | Memory Runtime 列表 |
| `ROVAI_RECOVERY_ADAPTER` | Recovery Runtime |
| `ROVAI_KEEP_SMOKE_FIXTURE=1` | 保留 intake fixture 供排查 |

脚本支持的精确值、默认值和额外模型变量以脚本源码为准。新增 selector 时应在同一改动
中更新本表。

## UI 验收命令

以下命令使用已打包 App 和隔离 `userData`，不调用模型：

```bash
pnpm package:mac
pnpm accept:memory-ui
pnpm accept:member-avatar-ui
pnpm accept:member-lifecycle-ui
pnpm accept:notification-ui
```

fixture、截图、窗口尺寸和直接调用 capture 脚本的方法见
[桌面 UI 验收](ui-acceptance.md)。

`accept:v0.16`、`accept:v0.17` 等带版本号的聚合命令属于历史版本验收入口，不是常青
日常门禁。其精确断言、Migration 版本和证据应从对应版本实施文档或测试源码读取。

## 隔离与副作用

- Smoke 应使用临时 Core `data-dir`、临时工作区和独立配置投影；不得读写日常
  Rovai-ai SQLite。
- Runtime Smoke 会继承当前进程可见的上游认证环境，但不应改写用户级 Runtime 配置。
- 任何声明会写文件的测试都必须把目标限制在临时 fixture；失败后先检查脚本是否保留
  了排查路径，再决定清理。
- 模型回复、耗时和费用不是稳定断言。测试应断言协议、状态、证据和限定 marker。
- 某个 Smoke 通过只证明该 suite 的范围，不代表九种 Runtime 的完整兼容性复核。
