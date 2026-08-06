---
document_type: implementation-plan
version: v0.42
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-06
---

# v0.42 实施与验收计划

字段和组件职责分别以
[Transport Contract](../../contracts/builtin-tool-transport-v1.md)与
[Runtime Architecture](../../architecture/builtin-tool-runtime.md)为唯一真源；本文件只记录版本内
工作和可复现验收事实。

## Checkpoint 1：合同与领域边界

- [x] 确认两层合同并删除 `result.task`；
- [x] 领域 catalog 只保留 canonical name、inputSchema、resultSchema 和业务说明；
- [x] `tool describe` 发布精确 resultSchema、稳定 error/recovery 和版本化 envelopeContract；
- [x] Envelope/receipt 只由 Core Router 生成；
- [x] 乐观锁冲突公开 allowlist details 与 `refresh_then_decide`；
- [x] 删除全局、成员与 Profile Memory 写开关和 Capability gate；
- [x] 删除外部 MCP 名称对 `rovai_team` 的特殊保留。

## Checkpoint 2：CLI、IPC 与 Runtime 生命周期

- [x] 增加 `rovai` binary、十二组命令、直接参数、stdin/heredoc 与 input-file；
- [x] 增加版本化 Unix IPC、1 MiB 上限、同 requestId 有界重试和 indeterminate outcome；
- [x] 增加 process identity、每次 acquire 轮换的 active lease、私有 context/run tmp；
- [x] Core Router 统一认证、Schema 校验、重放、分发、Envelope、receipt 与 Evidence；
- [x] Resident Runtime release 等待调用 quiescence 后 fencing；one-shot Runtime 结束时 fencing；
- [x] Codex/ACP/Claude/Antigravity 全部注入相同 CLI 环境，覆盖正式九 Runtime；
- [x] Bootstrap 只公布 CLI 使用原则和 discovery，不复制 catalog 或 secret。

## Checkpoint 3：删除旧运输与产品面

- [x] 删除 Team MCP Server、stdio bridge、attested bridge 和 Runtime-native built-in config；
- [x] 删除 Antigravity built-in Plugin/config/permission 管理；
- [x] 删除旧 Team/context MCP smoke 与 Core 启动参数；
- [x] 外部 MCP Library、Assignment 与 Runtime Projection 保持独立；
- [x] Renderer 删除 Memory 权限开关和旧 Team Gateway 状态；
- [x] Electron allowlist、Contracts、Bootstrap、开发脚本同步收敛；
- [x] build/extraResources 同时携带 `rovai-core` 与 `rovai`。

## Checkpoint 4：自动验证

- [x] `cargo fmt --all -- --check`；
- [x] `cargo test --workspace`（302 lib + 2 CLI + 47 main tests；7 个显式 ignored manual tests）；
- [x] `cargo clippy --workspace --all-targets -- -D warnings`；
- [x] `pnpm typecheck`；
- [x] `pnpm test`（Vitest 29 files / 186 tests；Node 78 tests）；
- [x] `pnpm build:desktop`；
- [x] `git diff --check` 与旧运输静态扫描。

## Checkpoint 5：九 Runtime 真实 CLI 矩阵

统一命令：`pnpm smoke:builtin-cli`。每行必须是一个真实模型 AgentRun，不接受 mock 或只做
Deep Probe。

2026-08-06 在同一轮联合矩阵中通过 9/9。每行均由真实模型执行全部十二项；完整 Run 观察到
13 条 Core Evidence（十二项成功调用，加一次用于验证 `task.update` 乐观锁的冲突调用）。

| Runtime | 实测版本 / 模型 | 发现/describe | 十二项调用 | 冲突/recovery | 双 lease fence | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | `0.146.1` / `gpt-5.3-codex-spark` | pass | 12/12 | pass | pass | pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | 12/12 | pass | pass | pass |
| GitHub Copilot | `1.0.78` / `claude-sonnet-5` | pass | 12/12 | pass | pass | pass |
| Claude Code | `2.1.220` / runtime default | pass | 12/12 | pass | pass | pass |
| Antigravity | `1.1.10` / runtime default | pass | 12/12 | pass | pass | pass |
| Kiro | `2.16.1` / `auto` | pass | 12/12 | pass | pass | pass |
| Qoder | `1.1.14` / `deepseek/deepseek-v4-flash-pg` | pass | 12/12 | pass | pass | pass |
| CodeBuddy | `2.132.0` / `deepseek-v4-flash` | pass | 12/12 | pass | pass | pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | 12/12 | pass | pass | pass |

联合结果同时确认：9/9 logical conversation continuation；Codex、OpenCode、Copilot、Claude、
Qoder、CodeBuddy、Qwen 保持原生 session；Antigravity 与 Kiro 的 one-shot 路径创建新的原生
session，但仍保持 Rovai logical conversation。Codex 本机默认模型当时触发账户配额，改用同一
Codex Runtime 内可用的 `gpt-5.3-codex-spark` 后完成精确合同验证；这不改变 Runtime 结论。

## Checkpoint 6：Release 与 App 包

- [x] `pnpm core:build` 生成 Release `rovai-core` 与 `rovai`；
- [x] `pnpm package:mac` 生成 arm64 `.app`；
- [x] bundle 内两个二进制 mode、Mach-O 架构、CLI version 与深度签名检查；
- [x] packaged App 启动、Core readiness 与八组 Renderer/UI 验收检查；
- [x] 最终工作树、并行 UI 变更和提交范围复核；
- [x] commit 并 push `main`。
