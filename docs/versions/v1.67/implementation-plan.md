---
document_type: implementation-plan
version: v1.67
authority: version-implementation-and-acceptance
status: completed
last_updated: 2026-09-23
---

# v1.67 实施与验收

## 实施

1. Core Task 命令与 read model 删除对象版本；更新事务只覆盖显式提交字段，继续验证 actor、当前
   Assignee、状态机和终态，命令 ID 继续由 Domain Command Gateway 去重。
2. Migration 171 删除当前 Task、AgentRun、MessageDelivery 的 Task 专属版本列，重建受约束的表并
   保留业务行、外键及历史证据原字节。
3. Agent create/get/update/list 结果删除 `version` 和 `availableActions`；CLI help、Host、Desktop
   与 Web 更新输入删除 `expectedVersion`。编辑器只提交相对打开时发生变化的字段。
4. Bootstrap、Collaboration、Run Facts 与 Single Chat Guidance 从生成投影中省略模型可见
   `schemaVersion`；ContextManifest task refs 不含版本，digest 对新投影字节重算。新 Session 与
   Formatter/Manifest 版本轴按 [revision 3](model-context-change-task-versionless.md) 轮换。
5. 更新当前合同、示例、测量 oracle 和验收脚本；旧冻结输入不转换、重播或兼容解码。

## 验收

| 项目 | 核查证据 | 状态 |
| --- | --- | --- |
| Task 字段补丁、同字段后写覆盖、权限与幂等 | Core Task、权限和 CLI owner tests | 通过 |
| 新库与 v170 当前存储升级无 Task 版本列且保留业务行 | Migration 171 owner test、业务行及外键检查 | 通过 |
| Agent 四类输出与 Host/UI 无 Task 版本 | Rust 输出 fixture、TypeScript typecheck、Renderer tests | 通过 |
| 新模型投影与 Manifest 无技术字段，旧冻结输入拒绝 | Context slow tests（42 项）、投影 fixture/digest | 通过 |
| 仓库日常门禁和 Host Web 协议 | `cargo test --workspace`、`pnpm typecheck`、`pnpm test`、`pnpm docs:check` | 通过 |

## Rust 测试准入

沿用 Task、Context 和数据库 Migration 的既有 owner 测试；补充的断言分别验证字段独立写入、当前表
结构和模型投影字节。升级保留业务行与外键的风险需要独立 Migration 回归，不能只靠 Schema 字符串断言。

新增 `v171_removes_task_versions_without_changing_business_rows` 拥有 v170 当前存储到新表结构的业务行、
外键和重启边界：修复前输入保留 Task 版本列且无法满足新 Schema；现有单元层无法证明 SQLite 重建表时
保留数据。最小命令是
`cargo test -p rovai-core --features extended-tests --lib v171_removes_task_versions_without_changing_business_rows`。

退役三个仅拥有旧上下文迁移或旧冻结重放的 slow tests：
`v68_through_v71_clean_break_preserves_business_history_and_removes_old_context_state`、
`v93_clean_break_preserves_business_history_and_removes_old_context_state`、
`migrated_unmaterialized_batch_run_keeps_its_v26_projection`。本版明确不支持旧格式转换和旧执行重放；
现行投递与拒绝由 `dispatch_admission_accepts_only_new_context_contracts`、
`batch_context_version_snapshot_requires_current_uniform_input` 和 Migration 171 owner 验证。测试清单相对
变更前为删除三项、增加一项；定向命令为
`cargo test -p rovai-core --features slow-tests --lib context::slow_tests::`，全量日常命令为
`cargo test --workspace`。
