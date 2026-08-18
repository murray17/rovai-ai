---
document_type: version-decisions
version: v0.28
lifecycle: historical
last_updated: 2026-08-18
---

# v0.28 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0087](#adr-0087) | Core-Owned Durable In-App Notification Inbox | `accepted` |

<!-- legacy-adr:begin id=ADR-0087 source-file-sha256=29c854ed4ef57d9ca924ac84ed06b0226049a919c29475394bc382da4461f822 -->
<a id="adr-0087"></a>

## ADR-0087: Core-Owned Durable In-App Notification Inbox

迁移时原路径：`docs/adr/0087-core-owned-durable-in-app-notification-inbox.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0087
title: Core-Owned Durable In-App Notification Inbox
status: accepted
date: 2026-08-01
decision_scope: cross-version
source_version: v0.28
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0087 -->
<a id="adr-0087-context"></a>
### Context

Rovai-ai 需要让用户在应用内持续查看需要处理的 Runtime Permission Request 和已经结束的
CampTurn。临时浮层本身会消失，现有 Navigation 未读投影只表达 Camp 阅读状态，不能形成
按事件类型读取、标记已读或清除的通知收件箱。

来源领域事实由 Core 在 SQLite 事务中提交。若 Electron Main 在独立 JSON 文件中保存
通知，来源事实与通知之间会出现不可恢复的双写窗口，也会让备份、Camp 删除和多客户端
读取面对两个真源。若只在读取时重放 `event_log`，通知身份、已读和清除状态会依赖可变的
重放规则；`event_log` 也会被误用为 Event Sourcing 存储或 Notification Outbox，违反
ADR-0001 与 ADR-0013。

应用内通知因此需要一个持久、可分页且与来源提交一致的注意力投影，同时必须保持与
Approval、CampTurn 和 Camp 业务状态之间的单向依赖。

<a id="adr-0087-decision"></a>
### Decision

<a id="adr-0087-core-sqlite-是唯一持久真源"></a>
#### Core SQLite 是唯一持久真源

Core 在产生合格来源事实的同一 SQLite 事务创建 In-App Notification。通知具有自己的
稳定身份、关闭的类型集合、来源实体关联、创建时间以及已读和清除生命周期。它是用户
注意力投影，不是来源业务对象的副本：通知状态不得批准或拒绝 Approval，不得完成、取消
或重新打开 CampTurn，也不得改变 Camp 生命周期。

通知生成必须使用与来源命令相同的幂等和事务边界。命令重试、Runtime 重发或并发聚合
不得创建重复通知；具体来源键和聚合规则由当前版本生产设计冻结。

<a id="adr-0087-core-提供通知命令与-read-side"></a>
#### Core 提供通知命令与 Read Side

Core 提供 schema-versioned、scope-filtered 的分页通知 Read Side，以及标记一项已读、
全部已读和清除通知的显式命令。Read Side 可以关联当前来源可用性，但不能用当前业务
状态覆盖已经持久化的通知身份或用户阅读动作。

Core 可以在 `event_log` 中追加通知创建或状态变化事件，供客户端低延迟失效刷新；这些
事件不是通知历史真源。客户端丢失事件、重载或重启后必须从通知 Read Side 恢复，而不是
重放事件自行重建列表。

<a id="adr-0087-renderer-拥有呈现main-不保存副本"></a>
#### Renderer 拥有呈现，Main 不保存副本

Renderer 从 Core Read Side 展示通知入口、未读徽标、分页列表和临时浮层，并把点击转换
为现有应用内 Camp 导航。浮层丢失不删除通知，Renderer 重载不改变已读状态；只有显式
Core 命令可以改变持久通知生命周期。

Electron Main 不保存通知记录、未读游标或设备 JSON 副本，也不参与通知生成。Main 只
继续承担已有 Electron 窗口与安全 IPC 适配职责，不成为第三个通知状态持有者。

<a id="adr-0087-consequences"></a>
### Consequences

- 来源事实和通知创建可以原子提交，App 或 Renderer 崩溃不会留下无法判断的双写缺口。
- Core 需要新增持久 Schema、Migration、唯一来源约束、分页 Read Side 和生命周期命令。
- 通知中心可以跨 Renderer、Core 和 App 重启恢复，但仍不承诺 App 退出时出现系统提醒。
- 通知内容、保留、清除和来源删除必须有明确数据最小化规则，因为通知成为持久本地数据。
- 将来新增客户端时可以共享同一 Core 通知状态；平台呈现差异不能复制持久真源。

<a id="adr-0087-rejected-alternatives"></a>
### Rejected Alternatives

- **Electron Main JSON 文件。** 无法与 Core 来源事实原子提交，会产生双写、备份和删除
  不一致。
- **Renderer `localStorage`。** Renderer 重载、清站点数据或多 WebContents 会丢失或
  分裂通知状态，也不能安全观察所有 Camp。
- **只保留临时 Toast。** 用户错过后无法恢复，不满足已确认的持久通知中心。
- **读取时重放 `event_log`。** 会把事件提升为通知真源，且无法稳定表达已读、清除和
  历史规则演进。
- **每次动态扫描 Approval/CampTurn。** 可以展示当前业务状态，但不能区分何时形成通知、
  用户是否已经阅读，也会在规则变化后改写历史。

<a id="adr-0087-references"></a>
### References

- [v0.28 In-App Notifications](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0059: Runtime-Owned Resource Permissions](../v0.16/decisions.md#adr-0059)
- [ADR-0084: Conversation Surface Controls and Stop Outcome Projection](../v0.26/decisions.md#adr-0084)
<!-- legacy-adr-body:end id=ADR-0087 -->
<!-- legacy-adr:end id=ADR-0087 -->
