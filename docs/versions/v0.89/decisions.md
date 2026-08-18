---
document_type: version-decisions
version: v0.89
lifecycle: historical
last_updated: 2026-08-18
---

# v0.89 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0193](#adr-0193) | Durable Gather Barrier over Unified Message Delivery | `accepted` |
| [ADR-0194](#adr-0194) | Mandatory Typed Gather Completion Current Input | `accepted` |

<!-- legacy-adr:begin id=ADR-0193 source-file-sha256=61084e26046c3e588977e3bfd1e0436dabba2eeb1c2d4d58f97e04b20ca913fd -->
<a id="adr-0193"></a>

## ADR-0193: Durable Gather Barrier over Unified Message Delivery

迁移时原路径：`docs/adr/0193-durable-gather-barrier-over-unified-message-delivery.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0193
title: Durable Gather Barrier over Unified Message Delivery
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.89
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0193 -->
<a id="adr-0193-context"></a>
### Context

让 Lead 同时询问多个成员并在全部责任结束后统一综合，不能靠每个成员普通 return 逐次唤醒 Lead：同一
Conversation 会持续排队多个 continuation，先到结果也无法证明其余责任已经终态。进程内 suppress flag、正文
阶段解析或 Barrier 直接 spawn Run 又会在重启、retry、Stop 与并发终态时丢失关联或绕过 Delivery FIFO。

现有 CampMessage 与 recipient-specific Message Delivery 已经拥有公共事实、队列、attempt、Context gate、
Runtime readiness 和恢复权威。新能力必须扩展该统一权威，而不是建立第二套 inbox 或 scheduler。

<a id="adr-0193-decision"></a>
### Decision

Rovai 采用持久 Gather Barrier，并继续以统一 Message Delivery 作为唯一执行投递权威：

1. 一个 Gather 接受一条公共 CampMessage，并为 canonical-deduped recipient 创建 N 条 forward Delivery；每个
   GatherItem 的责任身份是对应 `dispatchDeliveryId`，而不是正文、message recipient 文本或临时状态。
2. Gather forward 在接受时即为 optional responsibility。成员照常公开 send；从 Item 当前 target Run 精确
   return 原 initiator 的 Delivery 持久冻结为 `gather_captured`，正常保留公共消息，但直接 settled 且不
   materialize initiator Run。普通 return 仍遵循 ADR-0163。
3. 显式 return 只提供结果 evidence，不结束 Item。Run 尚未 materialize 时以 forward Delivery 终态关闭；
   一旦 materialize，则以当前 retry generation 的成员 Run 终态关闭，并在必要时保存有界 final fallback。
4. 最后一个 Item 终态时，Barrier 在同一事务冻结 immutable completion input、CAS 标记 Gather ready，并在
   原 initiator recipient FIFO 创建唯一 Completion Delivery。Barrier 不直接创建 AgentRun。
5. Completion Delivery 使用冻结的 initiator Agent/Conversation、现有 attempt fence、wait condition、Runtime、
   Context 与恢复边界；空闲后只 materialize 一个 required continuation。Native Session 和当前 Default Lead
   都不是路由权威。
6. accepted A2A 与 AgentRun responsibility 使用独立、单调账本。Capture 消耗前者但不消耗后者；completion
   的 Run responsibility 在 Gather 接受时预留。
7. Stop、Camp 关闭或原 initiator 离场取消 Gather且不转交；Default Lead 变化不重路由；ready 后 retry 不得
   重开 Items。多个 Gather 各自创建 completion，并按 Barrier commit 顺序共享同一 FIFO。

本决定局部覆盖 ADR-0163 中“每个 return 必然创建 caller continuation”的条款，仅限可信 GatherItem 当前
Run 到冻结 initiator 的精确 return；ADR-0130/0131 的公共消息、统一 Delivery 与事件驱动恢复继续生效。

<a id="adr-0193-consequences"></a>
### Consequences

- 成员结果保持公共可见，Lead 不再被 N 条 return 逐次唤醒，并且聚合闭环可跨重启、retry 与并发恢复；
- Message Delivery、CampTurn budget、AgentRun trigger 与 Read Side 必须升级为判别联合和 retry generation；
- Barrier 的每个终态入口都必须和事实写入同事务，且以唯一约束/CAS 防止重复 completion；
- Gather acceptance 预留一个未来 completion responsibility，因此即使成员全部失败仍可让 Lead统一处理；
- 取消保留审计事实但不制造替代 completion，系统不会把结果静默转交另一个 Lead。

<a id="adr-0193-rejected-alternatives"></a>
### Rejected Alternatives

- **每个成员普通 return 后由 Lead 自行计数**：会创建 N 个 continuation，且模型私有历史不是持久 Barrier。
- **进程内 suppress wake 或短时间窗口**：重启和竞态后无法恢复，也不能证明关联来源。
- **解析正文、Mention 或阶段标题判断结果**：展示文本和身份关联混合，重命名与自然语言变化会误路由。
- **Barrier 直接 spawn Lead Run**：绕过 recipient FIFO、target-busy、attempt fence、Context gate 与恢复权威。
- **独立 Gather inbox/scheduler**：复制 Message Delivery 的队列和故障协议，形成两套执行真源。
- **按当前 Default Lead 转交 completion**：改变已接受请求的责任人和 Conversation，破坏幂等与审计。

<a id="adr-0193-references"></a>
### References

- [v0.89 版本目标](README.md)
- [ADR-0130: Public A2A Messages and Unified Delivery](../v0.45/decisions.md#adr-0130)
- [ADR-0131: Recipient-Scoped Event-Driven Delivery](../v0.45/decisions.md#adr-0131)
- [ADR-0163: Explicit Caller Return](../v0.62/decisions.md#adr-0163)
- [Gather v1](../../contracts/gather-v1.md)
- [Message Delivery v3](../../contracts/message-delivery-v3.md)
- [持久 Gather Barrier 架构](../../architecture/durable-gather-barrier.md)
<!-- legacy-adr-body:end id=ADR-0193 -->
<!-- legacy-adr:end id=ADR-0193 -->

<!-- legacy-adr:begin id=ADR-0194 source-file-sha256=6aec427d8d6db17ee9ae69b303600dcc5ce9f147db284f63348cb27d55f3c104 -->
<a id="adr-0194"></a>

## ADR-0194: Mandatory Typed Gather Completion Current Input

迁移时原路径：`docs/adr/0194-mandatory-typed-gather-completion-current-input.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0194
title: Mandatory Typed Gather Completion Current Input
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.89
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0194 -->
<a id="adr-0194-context"></a>
### Context

Gather completion 可能在成员结果公开很久以后才轮到原 Lead Conversation。普通 recent history 受 Profile、
边界与 payload budget 影响，不能保证每个成员、失败、无 send fallback 或多条公开 return 都恰好出现。让 Lead
从历史猜测“哪些人已完成”会把聚合正确性交给可选上下文；按当前 Gather 行临时重建又会让 Runtime recovery
收到与首次尝试不同的 bytes。

Context 的 Current Input 与 ContextManifest 已分别拥有 mandatory model projection 和 immutable evidence；
Gather 需要在这个既有边界中增加一个明确触发类型。

<a id="adr-0194-decision"></a>
### Decision

Rovai 为 completion continuation 增加 `gather_completion` invocation 与 closed、mandatory
`gather_completed` Current Input：

1. Barrier 冻结 gatherId、commandId、requestMessageId，以及每个 Item 的 recipient、dispatch Delivery、
   target Run、terminal status/source、ordered captured message references、bounded fallback 和 safe error。
2. Current Input 是每次 completion Run 的 mandatory final section。普通 public history 可以先被省略，但 Item、
   reference 和必需字段不得因预算静默丢弃；captured body excerpt 与 fallback 使用明确上限和 digest/原长度。
3. serialized Gather input 有独立 48 KiB 上限，为 96 KiB Runtime payload及 first-payload Bootstrap 留出空间。
   mandatory metadata 超限是 invariant failure，不能把不完整 payload 标记 ready。
4. Context Formatter 与 ContextManifest 分别升级版本。Manifest 冻结 invocation、Gather/Delivery/message identity、
   completion input schema/digest/byte length、ordered refs 与 exact rendered Dynamic Context bytes。
5. Runtime Input Delivery recovery 复用首次冻结 bytes；不得根据当前 Default Lead、Native Session、public history
   或可变 Gather state 重建。Conversation 是 durable route，Session 仅在 materialization 时按正常 binding 解析。

本决定扩展 ADR-0067/0147 的 Current Input closed union，同时保留 Context Delivery Profile 对 optional public
history selection/order 的所有权；因此不因 mandatory trigger shape 改变而升级 Profile。

<a id="adr-0194-consequences"></a>
### Consequences

- Lead 总能收到完整、可审计的聚合责任清单，即使公开历史被截断或某成员没有 send；
- Barrier 必须在 final output 尚可用的成员终态事务中持久保存有界 fallback；
- Context formatter、Manifest schema、recovery validation 与 Delivery preflight 必须识别新 invocation kind；
- captured refs 仍指向公开 CampMessage，模型可按现有 exact `camp.read` 继续读取完整内容；
- completion input 会占用显式预算，但不会通过删掉失败 Item 或 references 来伪造可接受大小。

<a id="adr-0194-rejected-alternatives"></a>
### Rejected Alternatives

- **依赖 recent public history**：optional selection 不能证明所有结果都存在，也无法表达无 send 或 pre-run failure。
- **在 dispatch 时读取最新 Gather 行重建**：retry/recovery bytes 会漂移，破坏 ContextManifest 与 accepted ACK。
- **把完整成员 final output 永久存入普通 AgentRun**：扩大通用数据保留边界；Gather 只需有界 fallback。
- **把 Native Session ID 冻结为路由权威**：Session 可替换或恢复，Conversation/Agent 才是 durable ownership。
- **超限时静默删 Item/ref**：会让 Lead基于不完整责任集给出错误综合。

<a id="adr-0194-references"></a>
### References

- [v0.89 版本目标](README.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context](../v0.21/decisions.md#adr-0067)
- [ADR-0147: Lossless Model Context Projection](../v0.50/decisions.md#adr-0147)
- [Gather v1](../../contracts/gather-v1.md)
- [ContextManifest Evidence v13](../../contracts/context-manifest-evidence-v13.md)
- [持久 Gather Barrier 架构](../../architecture/durable-gather-barrier.md)
<!-- legacy-adr-body:end id=ADR-0194 -->
<!-- legacy-adr:end id=ADR-0194 -->
