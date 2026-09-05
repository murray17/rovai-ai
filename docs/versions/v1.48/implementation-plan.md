---
document_type: implementation-plan
version: v1.48
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-05
---

# v1.48 实施与验收

## 实施范围

- [x] Pi Host 固定加入进程级 `--approve`，保留原生 ResourceLoader；v7 薄 Extension 仅做 Session 状态与逐轮 Bootstrap 注入。
- [x] 删除 Pi `partial_managed`、bash/edit/write Approval、shell resolution、Managed Input Receipt 与 Core 专属路由。
- [x] Prompt response 不再发布 started；首个精确匹配的 `agent_start` 原子接受 Delivery 并幂等发布 started。
- [x] Migration 139 归一 Pi capability permission options、profile 与非终态 Run permission value，退役 Receipt acceptance guard，并保留历史 Receipt 数据和合法 cascade。
- [x] 保留 Native Session/exact resume、Fleet/LRU、correlated abort、图片、Usage、无 Prompt Machine Ready 与 Preview/NotQualified 边界。
- [x] 更新 Runtime Contract、Architecture、Activity、compatibility、Renderer schema 回归和显式真实 Pi smoke 脚本。

## 验收矩阵

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Rust Core 全量回归 | `passed` | `cargo test -p rovai-core`：lib 496、CLI 32、main 218 通过；5 项显式真实 Runtime smoke 保持 ignored |
| Pi acceptance 慢速回归 | `passed` | `cargo test -p rovai-core --features slow-tests pi_agent_start_accepts_managed_prompt_without_receipt_once -- --nocapture` |
| Migration 与历史 Receipt cascade | `passed` | `cargo test -p rovai-core v135_through_v139_retires_receipt_admission_and_preserves_historical_cascades -- --nocapture` |
| Renderer 与类型 | `passed` | `MemberRuntimeParameters.test.ts` 26 项通过；`pnpm typecheck` 通过 |
| Smoke 脚本与文档治理 | `passed` | `node --check scripts/smoke-pi-runtime.mjs`、`pnpm docs:test`、diff-aware `pnpm docs:check:ci`、`cargo fmt --all -- --check` 与 `git diff --check` 通过 |
| 真实 Pi provider smoke | `not-run` | 显式 smoke 仍覆盖 Prompt、原生 Tool、final 与 `agent_settled`，但本轮未自动调用真实模型或消耗 provider 额度；资格保持 NotQualified |

## 完成条件

- Pi 只启动一条完整原生能力路径；Rovai 不投影 Tool Approval、sandbox、MCP bridge 或 active Receipt。
- Prompt response 不直接接受 Input；只有当前 owner-fenced `agent_start` 完成一次 Delivery transition。
- 新路径不生成或读取 Receipt；历史 Receipt 数据继续满足 UPDATE 不可变、外键完整性与父级 cascade。
- Pi permission options 为空，旧 profile、非终态 Run 与 capability snapshot 经 Migration 139 归一。
- 保留的 Session/Fleet/LRU/abort/图片/Usage/Ready 行为通过现有自动化，真实模型行为只留在显式 smoke。
