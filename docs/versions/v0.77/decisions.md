---
document_type: version-decisions
version: v0.77
lifecycle: historical
last_updated: 2026-08-18
---

# v0.77 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0185](#adr-0185) | Durable Composer Reply Intent and Explicit Recipient Resolution | `accepted` |

<!-- legacy-adr:begin id=ADR-0185 source-file-sha256=557ae1a39d7d7f1939b1d674b05fd6e76ccf05722d55db63670acfbca4d4ca70 -->
<a id="adr-0185"></a>

## ADR-0185: Durable Composer Reply Intent and Explicit Recipient Resolution

迁移时原路径：`docs/adr/0185-durable-composer-reply-intent-and-explicit-recipient-resolution.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0185
title: Durable Composer Reply Intent and Explicit Recipient Resolution
status: accepted
date: 2026-08-14
decision_scope: cross-version
source_version: v0.77
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0185 -->
<a id="adr-0185-context"></a>
### Context

用户消息提交已经要求 exact Core Draft revision，但 reply target 仍由 Renderer 在发送参数中临时提供。
点击 Agent 消息时，Renderer 还需要把可见 Structured Mention 写入 Draft。导航、重载、崩溃或发送失败
因此可能保留 Mention 却丢失引用，形成两个不同生命周期的用户意图。

更危险的情况是原作者已经离开 Camp、变为 `away` 或被移除。若 UI 写入失效 Mention 后在提交时把它
忽略，现有 Default Lead 规则会让“回复原作者”看起来成功，实际却交给另一个身份。Core 已经要求失效
Structured Mention 原子拒绝；Composer 需要在同一权威边界内持久化未解决状态，而不是依赖一次性的
Renderer 控件。

<a id="adr-0185-decision"></a>
### Decision

1. 用户的 reply intent 属于每 Camp 唯一的 Core-owned Composer Draft。Draft 持久化 nullable 同 Camp
   `replyToCampMessageId` 与是否仍需显式接收者选择，并与 Structured Content、附件共享 revision、过期、
   导航恢复和 accepted 后消费语义。
2. 用户点击“回复”是一个显式的双意图 Draft mutation，不是发送时的 recipient inference。若目标作者是
   当前可寻址 Agent，Core 在同一 revision mutation 中设置 reply target，并插入或复用可见的 canonical
   Member Mention；`@所有队员` 已覆盖作者时不重复插入。发送事务仍只从 Structured Content 派生收件人。
3. 若目标是用户或系统消息，mutation 只设置 reply target，不从历史收件人、Default Lead、作者或 reply
   relation 增加 Agent Mention。无显式 Mention 时，UI 必须如实显示当前 Default Lead。
4. 若 Agent 作者在 mutation 时已经不再是当前可寻址 CampMember，Core 保留 reply target、不写失效
   Mention，并持久化“需要显式选择接收者”。只有用户选择一个当前可寻址成员或 `@所有队员` 的 Draft
   mutation 才能清除此要求；取消引用则只清除 reply intent，不删除正文中可见的 Mention。
5. 用户发送命令不再接受 caller-supplied reply target。Core 从 exact Draft revision 同时读取 Structured
   Content、附件和 reply intent，重新校验目标消息、未解决选择与每个 Mention。任何失效都原子拒绝，
   保留 Draft，不创建 CampMessage、CampTurn、AgentRun 或 Delivery，也不回退 Default Lead。
6. reply relation 仍然只是公共引用边。它不参与 recipient union、Default Lead 选择、Delivery、wakeup、
   Task responsibility 或 Agent caller return。历史消息作者离队或移除不删除引用；Read Side 保留一层
   有界父引用并允许 UI 定位原消息。

本 ADR 局部替代 ADR-0128 中“用户发送命令可携带 optional reply target”的条款，并扩展 ADR-0080 的
Draft 持久化范围；两者关于 exact revision、Structured Content、附件和 accepted 后原子消费的其他决定
继续有效。ADR-0163 的 reply/recipient 正交性和 Agent-authored Core-managed reply reference 不变。

<a id="adr-0185-consequences"></a>
### Consequences

- Mention、引用和未解决接收者要求在导航、重启及失败后保持同一 revision 事实；
- Core Draft schema、Read Model、IPC 和用户发送参数需要版本化迁移，Renderer 不能维护第二份 reply state；
- 点击可用 Agent 仍是一动作，但结果中的 Mention 可见、可删除且可审阅；
- 点击失效作者会多一步显式选择，这是避免错误交付的必要摩擦；
- Snapshot 后仍可能发生竞态，因此 Core rejection 继续是最终权威，前端预检只负责更早暴露同一错误。

<a id="adr-0185-rejected-alternatives"></a>
### Rejected Alternatives

- **只在 Renderer 保存 reply target：** 导航、重载或发送失败会让持久 Mention 与临时引用分叉。
- **发送时从 reply author 推导 recipient：** 混淆公共引用边与执行边，且会把历史或失效身份变成隐式路由。
- **失效 Mention 忽略后使用 Default Lead：** 用户看到的“回复原作者”和实际责任人不同，违反无 fallback
  边界。
- **点击失效作者时完全拒绝引用：** 丢失用户正在回应的上下文；引用可以安全保留，执行接收者才需要修复。
- **关闭引用时同时删除 Mention：** Mention 是可见 Draft 内容，自动删除会改写用户已经审阅的寻址。

<a id="adr-0185-references"></a>
### References

- [v0.77 版本目标](README.md)
- [Camp Composer Draft v1](../../contracts/camp-composer-draft-v1.md)
- [ADR-0080: Durable Camp Composer Draft](../v0.25/decisions.md#adr-0080)
- [ADR-0128: Structured Draft-Only User Message Submission](../v0.43/decisions.md#adr-0128)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](../v0.62/decisions.md#adr-0163)
- [ADR-0058: Presence-Aware Routing and Execution Admission](../v0.15/decisions.md#adr-0058)
<!-- legacy-adr-body:end id=ADR-0185 -->
<!-- legacy-adr:end id=ADR-0185 -->
