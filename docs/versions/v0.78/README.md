---
document_type: version-overview
version: v0.78
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-14
---

# Rovai-ai v0.78：完整 Exact-Scope Memory View 与 Copyable Target

> 当前状态：长期决策、字段合同、Core、CLI、Skill、clean-break migration 与自动化验收均已完成。
>
> 前置版本：[v0.77 Durable Composer Reply Intent 与显式收件人解析](../v0.77/README.md)
>
> 后续版本：[v0.79 Camp 会话轻量打开与分段性能诊断](../v0.79/README.md)

## 版本目标

让在线长期记忆判断从 bounded Search 收敛为一次 complete exact-Scope View，再进行至多一次 Write。Agent
不再从 flat Search/Read 字段重组 revise identity，而是原样复制 View/Read 交付的不可分割 target。

本版本采用 pre-release clean break：产品尚未上线，不引入 grandfather、旧 Scope over-quota、pending
candidate 迁移或过渡状态；只清理 Memory domain，保留协作、成员、Runtime 与应用其他状态。

## 交付范围

### Complete View 与 target

- 新增第十三项 operation `memory.view`，支持 Hearth、当前 Agent Companion 与 exact Relationship pair；
- Hearth 是 local Rovai home application-global；Relationship 是 current Agent 的 complete applicable set，
  即 mutual 加 `current -> counterparty`，不含反向 directed；
- 成功一次返回 `complete=true + itemCount + totalBodyBytes + items`，无 pagination、cursor、truncation 或
  partial success；
- 每个 item 交付 `target(memoryId, revisionId, complete Scope identity)`；authorized body-bearing Read 使用
  同一 target，revise 只能原样复制；mutual item 明确不可由 Agent revise；
- View 在一个 SQLite transaction 内完成授权、查询、production serialization、64 KiB limit 与 evidence，
  超限或不变量损坏在 evidence 前 fail closed。

### Capacity 与 clean break

- 保留单条 canonical Memory Body 2,048 bytes 和既有条数限制；
- 新增 active current-body aggregate quota：Hearth application-global 16 KiB、Companion per AgentProfile
  16 KiB、Relationship unordered pair 12 KiB；
- create、active revise、reactivate、Hearth Review accept 和 Supersession Create 按事务最终状态检查净增长，
  Retire/Forget 释放配额；predictable rejection 继续形成 durable replay fact；
- schema 39 / migration 84 清理 formal Memory、Revision、keys、Review、Supersession、Memory evidence/FTS、
  Memory events/results，并保留非 Memory application state。

### Transport 与 Skill

- Built-in Tool Transport、CLI command version 与 Runtime capability 一起推进到 v11；Catalog 固定十三项；
- `memory.view` 使用 canonical-result-v1 Agent projection；Read/revise closed schema 改用 nested target；
- `memory-stewardship` 默认在线路径改为 `view -> write`，`search -> read` 只服务跨 Scope 广泛发现；
- v10 Session/capability 不能兼容 v11 catalog，不允许 mixed surface。

## 非目标与冻结边界

- 不分页、不返回 completion token、不降低 2,048-byte 单条语义上限；
- 不增加 embedding、多路召回、semantic duplicate authority 或 View/Write 跨调用 snapshot token；
- 不迁移或导出旧 Memory，不建立 grandfather/over-quota 过渡；
- 不改变 Hearth user review 权威、mutual user governance、Search ranking、Memory Entrypoint 或 Renderer UI；
- 不修改 Camp/Task/Message、Runtime Activity semantic taxonomy 或真实 Runtime 支持结论。

## 发布门槛

1. View 三 Scope、排序、Relationship actor-relative selection、complete/no-partial 和 pending isolation 通过；
2. copy-target Read/revise、mutual non-revisability 与 guessed/mismatched anti-oracle 通过；
3. legal extreme production serialization 可证明小于 64 KiB，corrupt/oversized 在 evidence 前 fail closed；
4. aggregate quota 覆盖所有净增长/释放路径、Supersession final state 与 durable replay；
5. migration fixture 证明只清理 Memory domain 并使 `view` evidence schema 可用；
6. v11 constants、十三项 catalog/CLI/help/golden/smoke 与 v10 compatibility fence 一致；
7. Core 全量、Rust format、Skill validation、script syntax、文档治理和 diff 门禁通过后标记 complete。

## 当前验收证据

- `cargo test --workspace` 通过：Library 445、CLI 12、Core 73；3 项真实 Runtime smoke 按合同保持手工 ignored；
- `cargo clippy --workspace --all-targets -- -D warnings`、`cargo fmt --all --check` 与 `pnpm typecheck` 通过；
- `pnpm test` 通过：ADR tests 21、Vitest 51 files / 337 tests、Node 179 tests；
- `pnpm smoke:memory` 通过；该 smoke 不调用模型或真实 Runtime；
- `DOCS_BASE_REF=origin/main pnpm docs:check:ci`、ADR HISTORY check、两个受影响 Skill 的
  `quick_validate.py` 与修改脚本的 Node syntax check 通过；
- 独立 Skill forward test 正确选择 exact Relationship View、复制 target、限制一次 mutation，并在
  incomplete/unavailable View 时停止；未执行真实 Runtime Skill smoke，因此不新增 Runtime 兼容性结论。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.77 切换为 historical；v0.78 在交付时成为 current，后由 v0.79 冻结为 historical；本概览与[实施计划](implementation-plan.md)保留完成证据 |
| ADR | 已更新 | [ADR-0186](decisions.md#adr-0186)完整替代 ADR-0183，冻结 complete View、copyable target、capacity 与 clean break |
| Contracts | 已更新 | 新增 [Memory Capture v3](../../contracts/memory-capture-v3.md)和[Built-in Tool Transport v11](../../contracts/builtin-tool-transport-v11.md)，v2/v10 转 historical 入口 |
| Architecture | 已更新 | [Online Memory Capture](../../architecture/online-memory-capture.md)与[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)切换到 View/target/v11 组件边界 |
| UI | 确认无需更新 | 本版本没有 Renderer surface；Memory View 是 Agent CLI operation，用户 Hearth Review 与治理 UI 不变 |
| Runtime Activity | 确认无需更新 | View 复用既有 Built-in Tool Activity/evidence domain，不增加 activity domain、phase、outcome 或 Renderer mapping |
| Runtime compatibility | 确认无需更新 | capability 字符串推进由 Transport 合同与代码覆盖；本版本不声称新的真实 Runtime matrix 实测结论 |
| Documentation routing | 已更新 | 文档导航、CURRENT、ADR/Contract/Architecture/Version 索引切换到 v0.78、ADR-0186、Memory v3 与 Transport v11 |
| Root README | 确认无需更新 | 项目定位、常青能力和 Runtime 支持范围不变；根 README 不记录内部 Memory transport 版本 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0186: Complete Exact-Scope Memory View](decisions.md#adr-0186)
- [Memory Capture v3](../../contracts/memory-capture-v3.md)
- [Built-in Tool Transport v11](../../contracts/builtin-tool-transport-v11.md)
- [Online Memory Capture architecture](../../architecture/online-memory-capture.md)
