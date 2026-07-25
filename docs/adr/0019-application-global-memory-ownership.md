---
document_type: adr
id: ADR-0019
title: "Application-Global Memory Ownership"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0019: Application-Global Memory Ownership

## Context

Lumen 的主要协作聚合以 Camp 为权限和生命周期边界，而 AgentProfile 是跨 Camp
延续的稳定成员身份。长期记忆如果由 Camp、Project 或 Conversation 所有，同一位
伙伴会在不同协作空间中形成互不相认的身份碎片；如果由 Native Session 或 Runtime
所有，切换 Adapter 时又会丢失 Lumen 承诺的连续性。

另一方面，应用级记忆可能引用某个 Camp、AgentRun、消息、Task 或 Git Commit。
若把来源对象的存在误当成跨边界授权，记忆可能把原本局部可见的信息泄露给未获授权
的伙伴。

## Decision

Lumen 建立一个应用级、由用户治理的 Memory Library。它独立于每个 Camp、
Project、Conversation、Native Session、Runtime 和 repository。

Memory Library 使用三种稳定所有权作用域：

```text
Hearth Memory
    面向本机 Lumen home 中的全部 AgentProfile。

Companion Memory
    绑定用户与一个 AgentProfile，跨该身份参与的 Camps 和 Runtime 变化延续。

Relationship Memory
    绑定一对无序 AgentProfile，跨两者共同协作的 Camps 延续。
```

作用域定义所有权和最大可见边界，不等于无条件向每个 AgentRun 注入全部内容。
具体召回和 ContextManifest 冻结由版本协议另行定义。

记忆可以保存对 Camp、AgentRun、消息、Task、Git Commit 或其他稳定对象的来源
引用，但引用不转移所有权，也不得扩大来源对象原有的可见权限。无法在目标记忆
作用域内合法概括的来源内容不得通过记忆跨作用域传播。

## Consequences

- AgentProfile 可以跨 Camp 和 Runtime 保持由 Lumen 管理的长期连续性。
- 删除 Camp 或移动 Project 不会仅因所有权级联而删除应用级记忆；来源变化和
  遗忘规则必须被独立建模。
- 所有记忆写入、搜索、召回和来源验证都必须执行应用级作用域检查，不能复用
  “当前 Camp 可见”作为充分授权。
- Relationship Memory 必须使用规范化的无序成员对身份；具体条目是否具有方向
  仍由版本协议定义。
- 未来若引入多用户账号，必须新增明确的用户/家庭所有权迁移，不能把当前本机
  应用边界静默解释成共享租户边界。

## Rejected Alternatives

- Camp-owned memory：会把稳定伙伴身份切碎到各 Camp，并让 Camp 删除意外决定
  长期认识的生命周期。
- Project-owned memory：Project 目前只是共享 repository binding 的派生视图，
  不是可拥有权威状态的领域实体。
- Conversation-owned memory：Conversation 只表达一个 AgentProfile 在一个
  Camp 内的私有连续性，边界过窄。
- Native Session 或 Runtime-owned memory：外部执行句柄可替换，不能成为
  Lumen 长期状态的身份来源。
- 来源对象自动授予记忆可见性：稳定引用是来源说明，不是跨作用域授权。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0007: Portable Conversation Handoff](0007-portable-conversation-handoff.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
