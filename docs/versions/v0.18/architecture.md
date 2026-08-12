---
document_type: version-architecture
version: v0.18
lifecycle: historical
authority: version-design
last_updated: 2026-07-28
---

# Rovai-ai v0.18 架构设计

> 版本范围：[README.md](README.md)
>
> 跨版本约束：
> [ADR-0064](../../adr/0064-default-on-bounded-automatic-partner-memory.md)
>
> 当时长期记忆 UI 规范已删除，原文见 Git 历史；当前规范见
> [Arctic Dawn 记忆](../../../apps/desktop/.impeccable/surfaces/memory-workspace.md)

## 1. 权威边界

SQLite 继续是 Policy、Proposal、Memory、Revision、Lifecycle 和 Supersession 的唯一真源。
Renderer 只通过 Core IPC 读取和提交用户命令；Runtime 只能通过绑定当前 AgentRun 的
`memory.propose_change` 提交一条有界建议。

```text
AgentRun + frozen capability + current epoch
                 │
                 ▼
       memory.propose_change
                 │
        Core transaction policy
         ┌───────┴────────┐
         │                │
 eligible non-Hearth add  ordinary pending / stable rejection
         │
         ▼
 Proposal(policy_auto) + Memory + provisional Revision + event
```

Projection 是从 SQLite 重建的只读文件。Skill 和 Memory Guide 只解释如何读取、提案和
理解 Authority，不能绕开 Core。

## 2. Migration v29 与 Contract

`memory_auto_policy` 的当前物理合同：

```text
singleton                         INTEGER PRIMARY KEY = 1
automatic_partner_memory_enabled  BOOLEAN NOT NULL DEFAULT true
version                           INTEGER NOT NULL
updated_at                        RFC3339 timestamp
```

IPC 使用：

```text
MemoryAutoPolicy {
  automaticPartnerMemoryEnabled
  version
  updatedAt
}
```

设置命令使用 expected-version CAS，写 body-free
`memory.auto_policy_changed` Domain Event。不存在 acknowledgement gate。

## 3. 事务内自动决策

`save_proposal` 先完成身份、Capability、Run/epoch、Secret、输入、Scope、Kind、方向、
重复和每 Run Proposal 总额校验，再持久化 pending Proposal。仅 `add` 候选继续判断：

```text
policy enabled
AND scope IN (companion, relationship)
AND policy_auto count for sourceAgentRunId < 1
AND active provisional count for scope bucket < 8
AND ordinary count/byte capacity available
```

Companion bucket 使用当前 `agentProfileId`。Relationship bucket 使用排序后的无序伙伴
对，mutual 和两个 directed 方向共享同一个计数。Relationship directed add 的 actor
只能是当前发起 Agent。

满足条件时，Core 在同一事务中接受 Proposal、创建 active Memory 和 provisional
Revision、记录 policy version 与事件。任一可回退的策略/额度条件不满足时保持
pending；非法、安全或 fencing 失败不回退。

## 4. Authority 与生命周期

自动形成只创建新 Revision，不改旧 Revision。Authority 顺序是：

```text
current input / authorization / repository and collaboration truth
> user_confirmed Memory
> provisional Memory
```

`memory.confirm` 和用户修订 provisional Memory 都创建新的 `user_confirmed` Revision。
Retire 释放正在沿用的自动额度；Reactivate provisional Memory 会重新检查对应 Companion
或 Relationship bucket。Forget 清除正文并保留无正文审计证明。

## 5. 读取合同

`memory.list` 返回：

- Memory 和 Revision Authority；
- 普通 Scope count/byte capacity；
- 非家园 Scope 的 active provisional count，包含稳定 `scopeKey`；
- Review、Lifecycle、Supersession 和伙伴身份。

Projection 继续把 Confirmed 放在 Provisional 前。Memory Guide 明确 provisional
Preference/Agreement/Lesson 可作为低优先级协作指导，但不是用户授权或批准。

## 6. Desktop 状态模型

`View` 增加 `memory`，SettingsSection 删除 `memory`。长期记忆页：

- Scope：hearth / companion / relationship；
- Governance：all / automatic / review / stopped；
- pending Proposal 使用 Radix Dialog 右侧抽屉；
- Memory 使用列表选择 + 固定详情，不用 pending Card 表达 provisional；
- 自动事件 payload 携带 memoryId、scope、kind 和 Relationship identity，App 通知可
  深链到刚形成的 Memory；
- sessionStorage 只保存非权威 UI 状态，永远不保存正式 Memory 真相。

## 7. 失败与恢复

- Policy CAS 冲突返回当前 version，Renderer 重新读取；
- Projection 问题只显示健康提示，可由用户触发确定性重建；
- Event polling 失败不改变 Memory，重新读取 Proposal/Library 恢复；
- App 关闭、通知关闭或切换页面没有领域副作用；
- 关闭全局策略不会遍历或修改 Memory 表。
