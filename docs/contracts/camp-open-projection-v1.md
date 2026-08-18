---
document_type: contract
name: Camp Open Projection
version: v1
status: accepted
source_version: v0.81
last_updated: 2026-08-15
---

# Camp Open Projection v1

本合同冻结 Desktop 打开 Camp 的有界 wire shape。它只属于 Renderer → Electron Main → Core 的
typed IPC，不进入 Agent Built-in CLI、Runtime tool catalog、Bootstrap 或模型上下文。

长期权威继续遵守 [ADR-0013](../versions/v0.06/decisions.md#adr-0013) 的 SQLite Read Side / high-water
边界与 [ADR-0058](../versions/v0.15/decisions.md#adr-0058) 的 enter-before-read Default Lead
reconcile。完整 `camps.snapshot` 保留为纯读兼容与诊断接口，但不是普通打开或事件刷新入口。

## Methods

### `camps.enter`

请求：

```ts
{
  traceId: string // UUID，只用于 data-minimized 性能分段
  commandId: string
  command: { campId: string }
}
```

Core 在同一串行 request 中先执行幂等 `camp.default_lead.reconcile`，再读取 reconcile 后的
`CampOpenProjection`。reconcile rejected 时整个 request 失败，不返回 reconcile 前投影。响应不暴露
`StoredCommandResult`，Renderer 只消费最终权威视图。

### `camps.open`

请求为 `{ traceId: string, campId: string }`，只读取 `CampOpenProjection`，不执行 command。它用于当前
Camp 的事件失效、发送完成、Approval/Task/Lead mutation 后刷新；不得用它绕过一次真实 enter。

两种方法都必须在一个 SQLite read transaction 中捕获 `throughGlobalSequence`。Renderer 只能接纳
同一 Camp 且 high-water 不倒退的响应。

### `camps.exists`

请求为 `{ campId: string }`，响应为 boolean。它只用于 `camps.enter` 失败后的冷启动目标失效判定，执行
一次 indexed SQLite existence read，不返回 Camp 数据、Navigation 或错误详情。只有明确 `false` 才允许
Renderer 把冻结目标降级为 Quick Chat；`true` 或该检查自身失败都必须保留局部错误并允许重试。

`camps.exists` 不替代 `camps.enter`，不得用于构造页面、绕过 Default Lead reconcile、预取全量导航或向
Agent/Runtime 暴露。它是 v0.82 对本 Desktop-only 合同的 additive method，投影 shape 与 v1 窗口不变。

## Projection

```ts
interface CampOpenCollectionCoverage {
  loadedCount: number
  totalCount: number
  omittedCount: number
  complete: boolean
}

interface CampOpenMessageCoverage extends CampOpenCollectionCoverage {
  oldestLoadedSequence: number | null
  newestLoadedSequence: number | null
  hasEarlier: boolean
}

interface CampOpenProjection {
  schemaVersion: 1
  throughGlobalSequence: number
  camp: CampSnapshot['camp']
  members: CampMemberView[]
  tasks: TaskView[]
  messages: CampMessageView[]
  messageDeliveries: MessageDeliveryView[]
  turns: CampTurnView[]
  agentRuns: AgentRunView[]
  executionEvidence: AgentRunExecutionEvidenceView[]
  approvals: ActionApprovalView[]
  timeline: DomainEventView[]
  coverage: {
    tasks: CampOpenCollectionCoverage
    messages: CampOpenMessageCoverage
    messageDeliveries: CampOpenCollectionCoverage
    turns: CampOpenCollectionCoverage
    agentRuns: CampOpenCollectionCoverage
    executionEvidence: CampOpenCollectionCoverage
    approvals: CampOpenCollectionCoverage
    timeline: CampOpenCollectionCoverage
  }
}
```

`loadedCount + omittedCount == totalCount` 且 `complete == (omittedCount === 0)`。空消息窗口的两个 sequence
均为 `null`。所有集合只包含同一 Camp 的事实，排序与窗口固定如下：

| 集合 | v1 窗口与排序 |
| --- | --- |
| `members` | 全部 CampMember，按 member order；不截断 |
| `tasks` | non-terminal 优先、再按 `createdAt DESC, id`，最多 100 |
| `messages` | 最近 20 条非 tombstoned 消息，响应按 `sequence ASC, id`；较早内容由分页补齐，避免长 Markdown 在首屏同步渲染 |
| `messageDeliveries` | non-terminal 优先、再取最新，最多 200；响应按创建顺序 |
| `turns` | non-terminal 优先、再取最新，最多 64 |
| `agentRuns` | non-terminal / unresolved-effect 优先、再取最新，最多 96 |
| `executionEvidence` | 仅投影中 non-terminal Run 的最新 80 条，响应按发生顺序；terminal Run 详情按需读取 |
| `approvals` | 仅 pending，最多 32 |
| `timeline` | 最近 160 条首屏 presentation event，仅含 Task entity 与 `camp_turn.cancel_requested`，按 global sequence ASC |

首屏 wire 不含 Context Manifest、Runtime Input Delivery Evidence、Action history 或完整 Timeline。Run 的
`executionEvidenceCount` 仍表达 durable 总数，用户展开 terminal Run 时复用
`agentRunEvidence.list/getContent` 按需读取。

## Earlier message page

`camp.messages.page` 请求：

```ts
{
  campId: string
  beforeSequence: number // exclusive，必须 > 0
  throughGlobalSequence: number // 来自已接纳 open projection
  limit?: number // 默认 50，范围 1..100
}
```

响应：

```ts
interface CampMessagePage {
  schemaVersion: 1
  campId: string
  throughGlobalSequence: number
  requestedBeforeSequence: number
  nextBeforeSequence: number | null
  hasMore: boolean
  messages: CampMessageView[] // sequence ASC
}
```

Core 拒绝未来 high-water、无效 Camp 与非正 cursor。`nextBeforeSequence` 是返回窗口最老消息的 sequence；
`hasMore` 为 false 时必须为 `null`。Renderer 按 stable message ID/sequence 合并，并在 prepend 后保持用户
当前阅读位置。新消息只追加更大 sequence，不改变 earlier cursor；schema/Camp/high-water 不兼容时停止
合并并重新读取权威 open projection。

## Instrumentation

同一 enter/open `traceId` 可跨 Renderer、Main 与 Core 记录阶段、duration、payload bytes、schema、
high-water 与集合 count。日志不得包含 Camp ID、标题、消息正文、附件路径、命令/模型输出、Evidence
payload 或其他稳定实体 ID；未知或非法 trace ID 直接拒绝，不能原样写日志。

## References

- [Camp Open Read Path](../architecture/camp-open-read-path.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [v0.81 实施计划](../versions/v0.81/implementation-plan.md)
- [v0.82 实施计划](../versions/v0.82/implementation-plan.md)
