---
document_type: implementation-plan
version: v1.69
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-09-25
---

# v1.69 实施与验收

以下既有验收记录仅证明原主动读取／搜索与 RunCard 修复，不能沿用此前的通过记录证明新 Formatter／Manifest 30、Run Facts 8 或 Charter revision 14。[已确认的 historyHint 追加变更 revision 4](model-context-change-history-hint-additional.md)正在实施；按 Principal 要求停止测试与子 Agent 验收，本页另列其当前证据和未完成项。

## 实施切片

1. 在 `camp_history.rs` 的显式 read/search 查询中允许 recallable 和本队员 waiting Delivery；保留 Camp 存续、publication、tombstone 及各工具原有的实时/冻结边界。`RUN_INPUT` 与 quote-source 过滤不改。
2. `camp.read` 将撤回行在原 sequence 投影为只有 `messageId`、`sequence`、`withdrawn: true`、`displayText: "Message withdrawn"` 的状态项；按 ID 与时间线共用投影，线程 anchor 保留不可恢复处理，分页上限仍是 100。
3. 更新 Built-in 输出 Schema、CLI 帮助、Camp History 合同、当前 Architecture 和文档路由；撤回事务与首个 claim 条件不改。Renderer 撤回确认文案改为“尚未领取”。
4. 扩展既有 `camp_history`、`context` 和 `team_tool_catalog` 测试 owner，验证读取、搜索、Schema、撤回后重读、分页与跨 Camp 边界；运行 Rust、前端、文档和提交门禁。

## 验收矩阵

| 验收项 | 证据 | 状态 |
| --- | --- | --- |
| 当前 Camp claim 前正常读取和搜索，读取不领取 Delivery | `camp_history::slow_tests::camp_read_returns_the_selected_page_and_item_body_without_size_clipping` | 通过 |
| 撤回后 `camp.read` 状态项占原序号且无原文，搜索不再命中；100 条分页仍完整 | 同一 `camp_history` owner 与 `team_tool_catalog::tests::camp_read_output_contract_distinguishes_original_and_withdrawn_items` | 通过 |
| 跨 Camp 搜索仍受冻结发布边界，跨 Camp 读取仍实时 | `context::slow_tests::public_history_is_readable_without_target_camp_membership_or_live_recheck` 与 `history_snapshot_order_and_titles_remain_frozen` | 通过 |
| 首个 claim 仍是撤回边界，quote-source 隔离不变 | `collaboration::slow_tests::recallable_local_composer_message_is_erased_and_cannot_be_republished`、默认 Rust 的 `delivery_queue::tests::waiting_deliveries_create_no_run_until_fifo_batch_claim` 与 `message_quote` owner | 通过 |
| Rust、前端构建与文档门禁 | `pnpm test:rust:pr`、`pnpm typecheck`、Vitest 2197 项、`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check`、`pnpm docs:check:ci` | 通过；PR CI 待运行 |
| 全量 Node 聚合测试 | `pnpm test`：Vitest 2197 项通过；Node 326 项中 324 通过、2 项因旧 current-contract profile 的 v1.66/v1.67 固定断言与当前 v1.68 数据合同不符而失败 | 已记录基线问题，未改评测配置 |
| 真实任务双轨 Gate | [v1.68 记录](../v1.68/model-context-change-public-history-hint.md#实施与验证记录2026-09-23)证明原通用 Gate 的基线合同与退役自动历史清单已阻断所有 Trial；本版未重跑该受阻 Gate | 未完成，不作为通过证据 |

## 追加模型上下文变更：实施中

[revision 4](model-context-change-history-hint-additional.md) 已获二次确认。代码现已在同一 batch claim `Immediate` 事务使用冻结的 `P/T/I/A` 及无正文、无数量、无分页上限的 `EXISTS` 检查可见公屏历史；查询失败则回滚，`agent_run` 冻结 `P` 和布尔结果。Context 构造选四句完整文本，新建 Session 的 Charter 更新第二句；Formatter／Manifest 30、Run Facts 8、Profile 9、新建 Charter revision 14。Native Binding 兼容摘要的 `sessionCharterRevision` 保持基线 13，旧 Session 不因本次变更旋转 Binding，新 Run 沿用冻结 Bootstrap Evidence 投递新版动态内容；旧 Session 的原证据缺失时拒绝补写新版 Charter。其他 Runtime 兼容检查不变。迁移 173 已在重建 Manifest／Input 时临时关闭外键、事务内检验后恢复，且历史关联 Runtime Input Delivery、Manifest payload 与 Bootstrap Evidence 在升级前后和重新打开数据库后的定向测试此前通过；扩展数据库旧版降级 fixture 仍在收尾，不以当前通过记录宣称整体完成。

最近已运行的 `cargo test --workspace` 为 Core 默认 378 通过、1 ignored，其余组无失败；`delivery_queue::tests` 为 22/22，两个 batch historyHint 慢测为 2/2，原附件路径冻结慢测与迁移 v172→v173 历史证据保全定向测试亦通过。此前的 `pnpm typecheck`、`cargo fmt --all --check`、`pnpm docs:test`、文档版本与决定门禁及 `DOCS_BASE_REF=origin/main pnpm docs:check:ci` 有通过记录；这些记录均不能证明后续修改。`--features extended-tests` 的 87 项 `db::tests` 最近**实际为 73 通过／14 失败**：11 项在只迁移到 v166 后断言 v170/current，2 项断言过时的 formatter 闭集，1 项旧版 v99 降级夹具无法容纳 Profile 9 行。其后已静态修正断言并调整仅供测试的旧版夹具，**未编译、未复测**；夹具仅保留由当前模板生成的 payload／fact 字节并重标版本以便模拟旧表，不能证明这些字节原本符合旧合同，也不能代替生产迁移证据。

容量估算只计 `RUN_INPUT` 区段和 historyHint 文本长度，未计完整必选 `RUN_FACTS`、其他区段或首轮 bootstrap；临界双消息可能在 claim 时被合并，随后最终完整 payload 检查失败。Principal 已明确本次不处理容量问题，此项保留为已知限制，不宣称容量门禁已闭合。冻结 true 的慢测使用测试数据库中模拟的 Run，并非“生产 claim true → 撤回 → 首次 materialize”的端到端测试。用户要求停止测试及不委派子 Agent 验收后，没有再启动测试；最近 `db.rs` 和 Binding 兼容实现改动后均未编译或复测，静态空白检查不代表通过验收。真实任务上下文双轨 Gate 尚未执行，不作为通过证据。

## Rust 测试准入

本版扩展 `camp_history.rs` 已有 SQLite 读取/搜索 owner、`context.rs` 已有跨 Camp owner 与 `team_tool_catalog.rs` 已有输出 Schema owner。新增断言覆盖同一次读取前后状态转换、marker 的闭合 shape 与 100 条分页保留；复用既有 fixture 比新增平行数据库夹具更低成本。

## 后续修复：RunCard 标题与聊天分页解耦

050「Skills Rebuild」诊断时共 51 条消息、27 个 Run；首屏仅第 32–51 条消息，18 个 Run 因触发消息未载入而回退为通用 purpose。触发原文仍在数据库中。

修复为 ReadModel 按返回 Run 的首条输入精确读取有界 `inputSummary`，Renderer 优先使用该字段；合同见 [Camp Open Projection v24](../../contracts/camp-open-projection-v24.md)。这是局部可逆读取修复，不满足新增 Version Decision 的准入门槛。

Rust owner 复用 `camp_open_tests.rs` 的现有业务 fixture，新增 `camp_open_run_titles_survive_message_paging`：原版本在触发消息退出 20 条窗口后无法提供独立标题。测试覆盖多输入优先级、历史 Run、正文/附件、Unicode 截断、撤回和 tombstone，且禁止 event_log 读取；该跨表读取与分页边界不能由纯函数测试代替。现有 fixture 删除已退役的 task.version 写入以适配当前 schema。

Renderer 的最小输入测试证明有无载入消息时使用同一摘要、显式 null 不恢复缓存原文及旧投影兼容。验证命令为 `cargo test -p rovai-core --lib --features slow-tests read_model::camp_open_slow_tests`、`pnpm exec vitest run apps/desktop/src/renderer/src/App.test.ts`、类型检查、Rust PR 门禁与通用文档门禁。

验收结果：三个 Camp Open owner 均通过；`pnpm test:rust:pr`、`pnpm typecheck`、Vitest 全量 2198 项、`pnpm build:desktop`（含 Web）、`cargo fmt --all --check`、`pnpm docs:test` 与 `DOCS_BASE_REF=origin/main pnpm docs:check:ci` 通过。运行期与 UI 测试使用隔离 fixture，未修改日常 Camp 数据。

## 历史勘误：2026-09-25 Bootstrap Evidence 缺失门禁

上文 historyHint 实施切片中“旧 Session 原证据缺失时拒绝补写新版 Charter”是当时的要求。PR #529 据此增加的 `native_session_id` 已存在即拒绝判断，在 TRAE 正常首次绑定后误拒绝首个输入；Principal 随后要求撤回。历史实施与测试记录保留原样，现行证据准备边界以[当前架构](../../architecture/foundational-invariants.md#context-session-bootstrap)和[本版设计勘误](model-context-change-history-hint-additional.md)为准。
