---
document_type: version-overview
version: v0.21
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-29
---

# Rovai-ai v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构

> 状态：完成（2026-07-29）
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.20 受管 Product Runtime 发现与自动恢复](../v0.20/README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.21 重构 Rovai-ai 交付给 Agent Runtime 的上下文合同：把 Native Session 生命周期内
稳定的 Bootstrap 与每个 AgentRun 的动态输入分离，删除模型无权控制的内部状态和重复
派生说明，同时保留不可变 ContextManifest、字节级恢复、Context Read Marker、共享摘要
和 Run 边界封顶检索。

本版本同时把 Agent Memory 的正式读取入口从物理 Markdown Projection 路径迁移到
Core 鉴权的索引、搜索和按 ID 读取合同。该迁移必须保持 SQLite 唯一权威、Memory Scope
和 Relationship Direction，并继续满足 Forget、写入来源透明度与有界 Agent 写入边界。

## 已确认范围

- 新版本编号为 `v0.21`，`v0.20` 作为已完成历史版本冻结。
- 上下文合同与替代 Memory Guide 所需的 Memory Entrypoint、检索、读取、Retrieval Keys
  和派生搜索索引在同一版本原子切换。
- Memory 持久容量同时调整；Hearth 上限确定为 32。
- 当前确认的 active Memory 条数目标为：
  - Hearth：32；
  - 单个 Agent 的 Companion：32；
  - 单个无序 Relationship Pair：12；
  - 单个 Agent 作为适用 actor 的全部 Relationship：48。
- 产品尚未发布，v0.21 直接采用新的 Memory schema、容量与读取合同，不回填、不兼容旧
  Memory 数据；开发数据库允许重建，不设计超限旧 Scope 的 grandfather 或自动收缩流程。
- 不保留 Formatter v3、旧 ContextManifest 或旧 Native Binding 的活动恢复兼容路径；
  开发数据库可重建，保留的只读历史不得被翻译成新载荷后继续执行。
- Active Memory Scope 只使用条数上限，不再保留聚合字节配额；单条 Memory Body 继续
  受 2,048 UTF-8 bytes 上限约束，Memory 工具另有独立响应预算。
- 删除 `provisional` / `user_confirmed` MemoryRevision 权威状态及人工确认状态机；所有
  Active Memory 对 Agent 同等生效。UI 可以按不可变写入来源区分“Agent 形成”与
  “用户创建/修订”，但来源不改变 Memory 的适用性或优先级。
- 删除覆盖所有 Scope 的通用 MemoryProposal 队列。合法 Companion/Relationship Agent
  写入在同一事务中直接创建 Active Memory 或 Current Revision；Hearth 是唯一例外，
  Agent 只能提交 Hearth Memory Proposal，逐条经用户接受后才生效。
- Memory 新增、Revision、Retire、Forget 或适用范围变化不触发 Native Session 轮换。
  Entrypoint 是发现缓存；`memory.read` 实时返回最新 Revision 或明确的缓存过期、删除、
  不再适用状态，并且绝不回退旧正文。

## 架构状态

上下文区段、Session 轮换、Memory 写入、Run Notice、附件路径和 Task 工具化的目标
合同记录在 [architecture.md](architecture.md)。四项跨版本切换已经形成 ADR：

- [ADR-0067：Native Session Bootstrap and AgentRun Context v3](decisions.md#adr-0067)；
- [ADR-0068：Brokered Memory Retrieval and Session Entrypoint](decisions.md#adr-0068)；
- [ADR-0069：Single Effective Memory and Scope-Bounded Agent Mutation](decisions.md#adr-0069)；
- [ADR-0070：Normalized SQLite Memory Store v2](decisions.md#adr-0070)。

它们均已于 2026-07-29 接受；对应旧 ADR 已原子标记为 `superseded`，局部替代条款也在
ADR 索引和原决策中建立了指向。

Migration、合同、Core、Runtime Adapter 与 Renderer 已按实施计划完成；完成状态由
实施计划中的代码、Migration、自动测试、真实 Runtime Smoke 与 macOS 打包验收证据
共同支持。

## 完成定义

领域语义、迁移策略、模型可见合同、恢复协议和安全边界均已冻结并实现。完整完成定义
和 2026-07-29 验收证据见 [implementation-plan.md](implementation-plan.md)；本版本现已
冻结为历史快照，不再作为当前版本范围。
