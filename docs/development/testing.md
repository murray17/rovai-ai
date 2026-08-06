---
document_type: development-guide
authority: test-command-routing
last_updated: 2026-08-03
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
| `pnpm smoke:mcp-presets` | Context7、Playwright reviewed default 的真实 MCP initialize 与 tools/list | 联网；不调用模型 |

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
| `pnpm smoke:builtin-cli` | 全部九种正式 Runtime | 每个真实 AgentRun 发现/describe 同一 catalog，调用十二项 CLI operation，验证冲突 recovery、release fence 与后续 Run 新 lease；任一 Runtime 缺失、未认证或漏项即失败 |
| `pnpm smoke:skills` | Codex 默认；selector 接受全部九种 Product Runtime | `ROVAI_SKILL_SMOKE_ADAPTERS=all` 会逐一尝试九组真实投递与发现；只有本机 Runtime 已安装、已认证、已接入 AgentRun 且全部通过时才成功 |
| `pnpm smoke:mcp` | Codex、Claude Code、OpenCode、Copilot；可选 CodeBuddy、Qwen Code | 默认前四种；保留 Runtime 原生配置并逐 Run 追加 MCP；OpenCode 默认使用 `opencode/mimo-v2.5-free` |
| `pnpm smoke:mcp-projection` | Codex、Claude Code、OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code | 通过真实 Core、Assignment、AgentRun Projection 与 ContextManifest 验证原生配置保留及 Adapter-specific 同名策略；Codex 同名项应跳过，另外七种应由 Rovai 整项优先；默认八种 |
| `pnpm smoke:memory-runtime` | Codex + Claude Code | 可只选一种；Claude 有 bounded model/budget 配置 |
| `pnpm smoke:recovery` | OpenCode 默认 | 可选择其他产品 Runtime；创建 Git fixture 并杀死 Core 验证恢复 |

`pnpm smoke:runtime-permissions` 是 `smoke:action-approval` 与
`smoke:multi-agent` 的聚合命令。

### Qualification 与本地结果投影

| 命令 | 用途 | 安全边界 |
| --- | --- | --- |
| `pnpm qualification:case` | 创建、密封或检查 Case | 正式私有 Pack 不进入仓库 |
| `pnpm qualification:run` | 执行单一隔离 Trial | 正式模式要求 packaged Release Core |
| `pnpm qualification:evaluate` | 对保留的同一 Snapshot 恢复评测，或在已有完整性失败证据后显式标记不可恢复 | 不得重新投递团队；`--mark-irrecoverable` 只接受已有失败 attempt 的固定 reason code |
| `pnpm qualification:suite` | 执行校准和确定性重复矩阵 | 校准失败时不得产生正式 Pass Rate；诊断模式必须引用失败校准 |
| `pnpm qualification:project` | 从完成的正式 Suite 或显式诊断 3×4 选取清单生成脱敏报告并投影到本地 Rovai Project | 写日常 Core 前要求 App/Core 已停止；使用 `execution=null`，不得制造 AgentRun |

`qualification:project` 对 `status=completed`、校准通过且 12 个正式 Trial 完整的 Qualification
Suite 直接使用 Suite 中的 3×4 身份；post-gate 诊断仍必须同时传入显式 selection 与失败的前置
校准摘要。脚本验证每个 round/case 只有一个有效结果，保留旧报告到 Project 的 `reports/`
目录，并可用 `--sync-default-team-runtimes` 把已验证的冻结四角色配置写回日常 Core。它不是自动
挑选最好结果或绕过校准的入口。

Team Case 可在密封 manifest 中声明 `collaboration` 合同。Runner 将它与功能 Verifier 分开审计：
指定成员必须真实获得 Run，Member Call 达到下限，持久输入与投递完成机械收敛，Task 完成和
轮询证据满足合同。路由是否必要、消息是否重复以及 Lead 是否正确整合属于 Judge 的语义评审，
不能由协议计数推断。没有该字段的旧 Case 仍只评估交付与编排，不应据此声称测到了 Team 协作。

## 常用选择器

| 环境变量 | 使用者 |
| --- | --- |
| `ROVAI_ACP_SMOKE_ADAPTER` | `smoke:acp-runtime` |
| `ROVAI_SKILL_SMOKE_ADAPTERS` | Skill Runtime 列表或 `all` |
| `ROVAI_SKILL_SMOKE_MODEL` | Skill Smoke 只选一种 Runtime 时要显式验证的模型 ID |
| `ROVAI_MCP_SMOKE_ADAPTERS` | MCP Runtime 列表 |
| `ROVAI_MCP_OPENCODE_MODEL` | MCP Smoke 的 OpenCode model；默认 `opencode/mimo-v2.5-free` |
| `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS` | 同名 MCP Projection Runtime 列表或 `all` |
| `ROVAI_CORE_EXECUTABLE` | 让 MCP Projection Smoke 使用指定 Core，例如 packaged App 内的 Release Core |
| `ROVAI_MCP_QODER_MODEL` / `ROVAI_MCP_CODEBUDDY_MODEL` / `ROVAI_MCP_QWEN_MODEL` | 同名 MCP Projection Smoke 的显式模型 |
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
pnpm accept:sidebar-ui
pnpm accept:structured-mentions-ui
pnpm accept:task-card-ui
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
