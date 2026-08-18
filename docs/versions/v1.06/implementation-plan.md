---
document_type: implementation-plan
version: v1.06
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-18
---

# v1.06 实施与验收计划

## 计划状态与使用方式

本计划实现 [ADR-0215](decisions.md#adr-0215)、
[Camp History Retrieval v1](../../contracts/camp-history-v1.md)与
[Built-in Tool Agent Output Projection v1](../../contracts/builtin-tool-agent-output-projection-v1.md)。Rust 测试遵守
[准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)。本版不启动日常 App、Core 或真实
Runtime，也不把 v1.05 未完成的 Windows 范围并入验收。

## Checkpoint 0：版本与长期权威

- [x] 将 v1.05 以 `implementation_status: in_progress` 冻结为 historical，并建立唯一 current v1.06；
- [x] 接受 ADR-0215，明确其只局部覆盖 ADR-0108，不修改历史 accepted ADR 正文；
- [x] 建立 Camp History Retrieval v1 与 Built-in Tool Agent Output Projection v1；
- [x] 更新 CURRENT、Architecture、Contract 与顶层任务路由。

## Checkpoint 1：统一单 Camp target

- [x] `CampSearchInput.camp_id` 和所有 `CampReadInput` variant 改为 `Option<String>`，同步闭合 Schema；
- [x] 共享 `CampTarget` resolver 处理 current/historical fence 与 live authorization；
- [x] 显式 UUID 在授权前校验，搜索不可用状态不泄露不存在/未授权差别；
- [x] 历史单 Camp 搜索覆盖 body、FTS、reference、plain-text reprojection、ranking 与 snippets；
- [x] 保持 History Search 多 Camp合同和 ADR-0170 self-write exact item 例外。

## Checkpoint 2：Public message publication seam

- [x] 集中定义 ordinary send/Public A2A 两种 qualifying event 与每消息最早 global sequence；
- [x] 历史 body/FTS/reference search、item、around、thread、timeline、root/parent 统一消费；
- [x] ContextManifest 历史 Camp `lastVisibleActivityAt` 与 Camp read model 使用相同 publication 语义；
- [x] 保持 global boundary、tombstone、private event 排除和零数据回填。

## Checkpoint 3：附件与 CLI 投影失败

- [x] `camp.read item` attachment Schema 必填 `kind/fileCount` 并保持闭合；
- [x] canonical/Agent golden fixture 同步真实 attachment shape；
- [x] CLI 投影失败输出 stable closed error、`recovery=stop` 与 operation-only details；
- [x] 完整错误写入 create-new private run diagnostic，Agent stdout 不含内部路径或 Rust error；
- [x] 保持 `builtin_tool.outcome_indeterminate` 既有 recovery。

## Checkpoint 4：教学与资格夹具

- [x] built-in descriptions 和 exact help 展示 current/explicit historical Camp 与 History discovery 调用链；
- [x] `cli-operations` Camp History reference 同步 single-target 语义；
- [x] Built-in CLI smoke fixture 覆盖省略 current read、显式 current search、historical search/read；
- [x] smoke script JavaScript syntax check 通过。

## Checkpoint 5：回归与治理

- [x] 定向测试覆盖 target 等价、历史命中/空结果、错误 UUID、不可用/撤权和全读取模式；
- [x] 定向测试覆盖 Public A2A publication 去重、历史可见性与 Manifest boundary；
- [x] 定向测试覆盖 attachment Schema/golden 与 Core-success projection mismatch/private diagnostic；
- [x] `cargo test -p rovai-core --lib`、CLI tests 与 `slow-tests` 目标回归通过；
- [x] `cargo fmt --all --check`、Clippy、`git diff --check` 通过；
- [x] `pnpm docs:adr:generate`、`pnpm docs:test`、`pnpm docs:check` 与 generate check 通过；
- [x] 最终差异复核并把版本状态更新为 complete。

## 最终验收结果

- `cargo test -p rovai-core --lib`：231/231 通过；`cargo test -p rovai-core --bin rovai`：14/14 通过；
- `camp_history_tools_freeze_scope_and_support_stable_reads` 与
  `response_budget_keeps_collection_items_and_item_reads_use_unicode_scalars` 在 `slow-tests` 下通过；
- `cargo check -p rovai-core --tests --features slow-tests` 与
  `cargo clippy -p rovai-core --all-targets --all-features -- -D warnings` 通过；
- `cargo fmt --all -- --check`、`node --check scripts/smoke-builtin-cli.mjs` 与 `git diff --check` 通过；
- `pnpm docs:test`、`pnpm docs:check`、`pnpm docs:adr:generate -- --check` 与基于真实 merge-base
  `0e20ea154eb3110f46d3a18f695dc2217b4e801b` 的 `pnpm docs:check:ci` 通过；
- 未启动 Desktop、Core 或真实 Runtime；Built-in CLI smoke 的本版变更完成静态语法和确定性 Rust
  回归，未把 v1.05 Windows/Runtime 资格范围混入本版完成证据。

## 完成后补充验收（2026-08-18）

原始完成结论保留上面的“不启动真实 Runtime”边界；后续根据使用反馈扩展既有
`smoke:builtin-cli` owner，并以 `ROVAI_BUILTIN_CLI_ADAPTERS=codex-cli pnpm smoke:builtin-cli`
补充执行真实纵向验收：

- 真实 Debug Core IPC 与真实 `rovai` contract-v13/ipc-v1 二进制启动成功；
- Codex 先导 AgentRun 使用真实 lease/context 执行 `rovai send`，同一消息同时具有
  `sourceAgentRunId`、`public_a2a` Message Delivery 与 `camp_message.public_a2a_sent` publication；
- 历史 Camp 另包含一条通过标准附件 prepare/composer/send 路径写入的普通文件附件消息；
- 另一个 Camp 的 AgentRun Manifest 明确冻结该历史 Camp，并由该 Run 自己的真实 lease/context
  依次执行 `rovai history search`、显式 `rovai camp search --camp-id` 与
  `rovai camp read --camp-id --mode item --message-id`；
- 三段调用命中同一 Public A2A identity，附件 item 返回精确 attachment identity、`kind=file` 与
  `fileCount=1`；完整十五项、successor new lease、lease fence 与清理均通过；
- 实测 Runtime 为 `codex-cli 0.147.0`、模型为 `gpt-5.6-sol`；模型只负责执行测试生成的固定脚本，
  业务结论仍由 Core IPC、CLI JSON、Manifest/Delivery/Event 与持久读取断言拥有。

## References

- [v1.06 版本概览](README.md)
- [ADR-0215](decisions.md#adr-0215)
- [Camp History Retrieval v1](../../contracts/camp-history-v1.md)
- [Built-in Tool Agent Output Projection v1](../../contracts/builtin-tool-agent-output-projection-v1.md)
