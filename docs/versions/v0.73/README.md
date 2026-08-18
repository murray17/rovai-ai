---
document_type: version-overview
version: v0.73
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-14
---

# Rovai-ai v0.73：在线长期记忆捕获与 Hearth 审核隔离

> 当前状态：Store v3 Migration、Core/IPC、CLI、Skill、Renderer 与 Built-in Transport v9 已完成实现，
> Rust/TypeScript/Node 自动化、Desktop build/package、Memory smoke 和文档治理门禁通过。九 Runtime
> 真实模型矩阵与完整隔离 App 视觉/交互矩阵仍待验收，因此尚不能把 v0.73 声明为 complete。
>
> 前置版本：[v0.72 Camp 沉浸世界地图会话视图](../v0.72/README.md)
>
> 后续版本：[v0.74 Runtime 对齐的协作 Skill 与双轴代码评审](../v0.74/README.md)

## 版本目标

把 Agent 长期记忆捕获收敛为纯在线、Runtime-native Skill discovery 驱动的 best-effort 流程。Agent 在
可能出现稳定偏好、未来协作规则或有证据的可复用经验时加载 `memory-stewardship`，经
`search -> read -> add/revise/stop` 形成最小写入；Core 不保存“机会”或替 Agent 判断语义相似度。

Agent 只能立即改变自己的 Companion 和 `current Agent -> present counterparty` directed Relationship。
Mutual Relationship 保留为用户治理的合法领域类型，Agent 可以读取适用 mutual，但不能单方面新增或
修订。Hearth 继续要求用户激活：统一 `memory.write` 只简化 Agent command choice，Core 内部仍创建与
Memory/Revision 完全隔离的 Hearth Review Item。

本版本同时关闭候选保留与 Forget 的最后一条重建路径：正式 Hearth 发布会原子作废同 Kind/body 的
pending add；Forget 在清除正式正文前对目标全部尚未清除的 formal Revisions 再次执行 reconciliation，
并清理所有 target/accepted-linked Review candidate。Accepted、rejected 和 invalidated Review Item 全部
只保留 body-free provenance。

## 交付范围

### Best-effort 在线捕获与 Skill

- 重写 `memory-stewardship` description、默认提示和渐进 references，以“可能包含长期信息”触发，而不是
  要求加载前已经认定它是 Memory；
- 显式自然语言“记住 / 以后默认 / 不要再 / 更正记忆”是高信号 opportunity，但不宣称确定性加载；
- Structured Renderer create/revise/retire/reactivate/forget/supersede 与 Review Decision 继续作为确定性
  user actor commands；Agent 不能用相反正文模拟 Forget；
- 不新增 Session Charter Memory capture 条款、Run final checkpoint、离线反射、Opportunity 表、semantic
  relation/classifier 或第二次 LLM 对照。

### Actor-bounded Agent mutation

- Agent add/revise 只允许 Companion(current Agent)、directed Relationship(current Agent → present
  counterparty) 与 Hearth submission；
- Agent 禁止 mutual、reverse directed、另一 Companion、Lifecycle、Review schedule 和 Supersession；
- 保留 current Binding/Run/epoch/fence/member/presence、Secret Filter、canonicalization、idempotency、
  exact duplicate/no-change、Revision CAS、每 Run 四次、active/Agent-origin capacity、body-free evidence；
- 不恢复 Member business Capability 或 `agentMemoryWritesEnabled`；ADR-0124 的固定 operation eligibility
  保持有效；
- `memory.search/read` 继续使用 ADR-0068 的 live authorization、cache states、FTS fail-closed 与 guessed-ID
  anti-oracle，pending Review content 永不进入 Agent read path。

### 独立 Hearth Review 与 Store v3

- `hearth_memory_proposal` 迁移为独立 `hearth_review_item`；正式 `memory_revision` 只保存真正发布过的
  content；
- persistent status 固定为 `pending | accepted | rejected | invalidated`，stale 由 target/base 当前状态派生；
- Review Item 使用 `expectedReviewItemVersion`，revise accept 另用 `currentRevisionId == baseRevisionId`；
- accept/edit-and-accept/reject/invalidate 都在 terminal 事务清除 candidate Kind/body/keys/digest；
- invalidation reason 固定为 `target_forgotten | exact_candidate_published`；
- formal Hearth create/revise 原子 invalidates exact pending add；Forget 清正文前对目标全部尚未清除的
  formal Revision body 再次兜底，并清理 target/accepted-linked rows；
- migration 保留 formal Memory/Revision/keys/Supersession；既有 Agent-origin mutual 内容不被破坏，但退出
  Agent mutation set。

### Built-in Tool Transport v9

- 固定 Agent command 从十三项减为十二项，Memory 只保留 `search | read | write`；彻底删除
  `memory.propose_hearth` 和 `rovai memory propose-hearth`；
- `memory.write` 使用 closed add/revise input；Core 按 target Scope 路由 direct mutation 或 Hearth Review；
- Agent success stdout 固定为 `{outcome: effective, memoryId, revisionId}` 或
  `{outcome: review_pending, reviewItemId}`，普通 stdout 不称 receipt；
- 同步更新 contract/CLI version、catalog digest、Runtime capability、root/exact help、input/result/output
  schema、golden fixtures、Charter 固定命令列表、Skills 和 qualification；
- 九个受支持 Runtime 必须逐一完成真实模型 command choice、outcome wording、conflict read-and-decide 与旧
  command absence 验收，不允许 mixed v8/v9。

### User Review Renderer

- Memory workspace 使用独立 Review drawer 显示 pending candidate、source、requested action、target/base 与
  exact decision，不把 candidate 混进 formal Memory list/history；
- fresh item 支持 accept、edit body/keys then accept、reject；derived stale revise 只支持 reject，不提供 silent
  rebase；关闭 drawer 不改变领域状态；
- terminal item 只呈现 body-free provenance，区分 accepted、user-rejected 与 system-invalidated；
- 冲突保持用户 draft/selection，刷新权威 item/Memory 后要求显式重试；Forget 使用现有 danger 与 preview
  语义。

## 非目标与冻结边界

- 不保证每条显式或隐式自然语言 opportunity 都加载 Skill、执行 search 或形成 write；
- 不引入 Agent-authored mutual acknowledgement protocol；普通两条 Message ID 不证明同一候选已双边接受；
- 不让 directed free text 对 counterparty 可读，不把 Relationship 变成跨 Agent 持久消息通道；
- 不引入 pending MemoryRevision、general Proposal、authority/confidence tier、semantic merge 或自动 Supersession；
- 不改变 Memory Kind、Scope、Lifecycle、Entrypoint/search/read 基本模型，或现有 active/Agent-origin 数值容量；
- 不新增 Runtime Activity domain/classifier、外部 MCP transport、模型供应商特例或 Agent-controlled full
  Envelope 输出；
- 不借本版本重设计 Memory workspace 的视觉世界、App Shell、主题、字体、框架或状态管理。

## 发布门槛

1. Store v3 migration 以 pre-v3 fixture 证明 formal Memory 无损、terminal candidate 清除、published-revision-equal
   pending add invalidation 与既有 mutual preservation；
2. Core property/integration tests 覆盖三 Scope 路由、mutual/reverse/other-Companion 拒绝、双 CAS、stale
   derivation、duplicate_pending 不泄露、publication reconciliation、Forget closure、quota/capacity 与
   idempotent replay；
3. Search/Read tests 证明 Review candidate 不进入 FTS、Entrypoint、search/read、snippet、event、durable result
   或 guessed-ID side channel；
4. Transport v9 catalog/help/schema/golden/lease/replay/negative-path tests 通过，源码与产物中不存在受支持的
   `propose-hearth` command route；
5. Memory workspace 在 Day/Night、1040×700、1440×920、2560×1440、200% zoom、键盘、长 CJK/emoji、
   Loading/Empty/Partial/Error/Conflict/Recovery 下完成隔离 App 验收；
6. 九 Runtime 真实模型 matrix 完成 direct effective、Hearth review_pending、conflict read-and-decide 和旧命令
   absence；Skill opportunity cases 单独报告，不把 bounded smoke 写成确定性保证；
7. `pnpm test`、`pnpm typecheck`、Rust tests、Desktop build/package、`git diff --check` 与全部文档治理门禁通过；
8. 只有上述证据都可复现后，才能把 implementation status 与计划 status 改为 `complete`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v0.72](../v0.72/README.md)以 complete 事实冻结为 historical；v0.73 成为唯一 current，并新增本概览与[实施计划](implementation-plan.md) |
| ADR | 已更新 | [ADR-0178](decisions.md#adr-0178)替代 ADR-0069，[ADR-0179](decisions.md#adr-0179)替代 ADR-0070，[ADR-0180](decisions.md#adr-0180)局部替代 Transport Memory command/output 条款 |
| Contracts | 已更新 | 新增 [Memory Capture v1](../../contracts/memory-capture-v1.md)与[Built-in Tool Transport v9](../../contracts/builtin-tool-transport-v9.md)，v8 降为 historical current-entry predecessor |
| Architecture | 已更新 | 新增 [Online Memory Capture](../../architecture/online-memory-capture.md)，并把[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)切换为十二命令与 outcome union |
| UI | 已更新 | [Memory workspace surface brief v2](../../../apps/desktop/.impeccable/surfaces/memory-workspace.md)改用独立 Review drawer、derived stale、body-free terminal 与 exact-version conflict 语义 |
| Runtime Activity | 确认无需更新 | v9 仍使用既有 Core-owned Built-in Tool Activity/Envelope evidence；只改变 canonical Memory operation catalog，不新增 provider event、activity domain 或 classifier mapping |
| Runtime compatibility | 确认无需更新 | 当前没有新的真实 Runtime 实测证据；兼容性清单保持事实原样，v9 九 Runtime matrix 是本版本待完成发布门槛 |
| Documentation routing | 已更新 | 文档导航、CURRENT、ADR/Contract/Architecture/UI 索引均路由到 Memory Capture v1、Transport v9 与 v0.73 |
| Root README | 确认无需更新 | 项目定位、常青能力和已支持 Runtime 范围未改变；根 README 不记录未实现的当前版本计划 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0178: Best-Effort Online Memory Capture](decisions.md#adr-0178)
- [ADR-0179: Normalized Memory Store v3](decisions.md#adr-0179)
- [ADR-0180: Single Agent Memory Write Command](decisions.md#adr-0180)
- [Memory Capture v1](../../contracts/memory-capture-v1.md)
- [Built-in Tool Transport v9](../../contracts/builtin-tool-transport-v9.md)
- [Online Memory Capture architecture](../../architecture/online-memory-capture.md)
