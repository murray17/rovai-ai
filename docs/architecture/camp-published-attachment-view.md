---
document_type: architecture
architecture: camp-attachments
authority: camp-attachment-storage-runtime-and-legacy-view
status: accepted
last_updated: 2026-08-27
---

# Camp Attachments 与 Legacy Published View

本架构拥有当前 Managed Attachment v2 写路径，以及既有 Published Attachment View v1 数据的只读兼容边界。
字段与状态合同见 [Camp Attachment v7](../contracts/camp-attachment-v7.md)，旧 publication 对象见
[Camp Published Attachment View v4](../contracts/camp-published-attachment-view-v4.md)。

## 当前组件边界

```text
Runtime external source -> CLI private snapshot -> Run tmp

Composer Prepared Attachment ─┐
                              ├─ durable ingest intent -> private staging
Agent workspace / Run tmp ────┘                         -> one copy + digest/fsync
                                                        -> opaque Managed v2 payload
                                                        -> SQLite semantic commit
                                                           ├─ CampMessage
                                                           ├─ managed_attachment
                                                           ├─ ordered Message refs
                                                           └─ ordinary Deliveries

legacy message_attachment -> legacy Authority/View resolver and recovery only
```

Prepared Attachment 仍属于私有 Draft。Core Agent ingress 仍只接受 exact execution workspace 或 `ROVAI_RUN_TMP`。
CLI 在首次 IPC 前把 Runtime 可读外部文件/目录私有快照到当前 lease Run tmp，沿用同一套安全复制和摘要能力；
Core 不接收原始外部路径，也不成为文件读取代理。重试复用同一快照，源文件不移动、不修改。
Managed v2 payload 是发送后唯一长期物理副本，位于既有 Camp-scoped Runtime attachment root 的保留子目录
`.managed-v2/<attachment-id>/payload/`。数据库只保存 runtime root-relative locator、不可变 receipt、Camp identity
与全局状态；同 Camp 多条消息通过 ref 共享该资源。

Runtime 是受信的本地同 UID 程序。只读 mode 用于降低误写，不构成对恶意 Runtime 的强隔离，也没有第二份
Authority 自动重建 v2 payload。Rovai 仍在 ingest promote 后验证最终 identity、类型和 digest/tree；Context 构造
不承担完整性扫描。

## 无 Run 等待的发送路径

Managed v2 ingest 有自己的短时 root 初始化互斥和 durable intent，但不使用 legacy Camp View read/write gate、
generation、quiescence 或 publication worker。它不得等待、停止或 fence 已运行的 AgentRun。复制和 hash 在
SQLite mutex 外执行；最终短事务再次验证 Draft/Run source 所需的权威条件并原子提交消息、refs、Deliveries 与
intent。

因此以下顺序合法且是验收目标：

```text
A AgentRun remains running
  -> A sends files
  -> v2 payload and CampMessage commit
  -> B Delivery enters ordinary dispatch
  -> A continues running
```

`camp.attachment_revision` 只标识新可用 v2 资源的单调顺序，不是 immutable generation，也不取得 Camp-wide
mutation admission。现有 Adapter 已持有精确 Camp `attachments` root；本变更不增加 global root、Inline、
Run-local copy、Host broker 或权限证据平台。

## Crash 与幂等

一个 intent 冻结 command identity、source kind、Draft revision（如适用）、附件 identities、reservation 与
materialization receipt。staging 和 final 位于同一 filesystem；final opaque identity 使用 no-replace reservation，
payload 原子 rename，随后重验并 fsync parent。只有最终 SQLite transaction 可以把 intent 和附件变为 committed/
available。

崩溃发生在 staging 后或 promote 后、commit 前时，startup reconciler 将 pending intent 标为 abandoned，并清理
其 staging/final orphan。commit 已完成但 Dispatch Pump 尚未唤醒时，普通 pending Delivery 由既有 restart pump
恢复。请求 replay 先读取领域 command result，不重复读取 Agent source 或创建第二份 payload。

## Context 与读取

Context、Camp History 与 Camp Open 通过 v1/v2 SQL union 读取持久 metadata。v2 路径由 database root function 与
root-relative locator 组合；这些路径在组装时不做 `stat/open/read_dir/digest`。本地文件缺失不会在这一阶段生成
unavailable descriptor、伪造正文、Run Fact 或全局状态变更。Runtime 真正读文件时由其原生工具报告失败。

只有成功从 legacy catalog 解析出的 v1 attachmentId 才进入本次 Context 的 legacy receipt。若没有成功解析出的
legacy 引用，receipt 使用 `catalogRevision = -1` 的 no-legacy sentinel，Context、Frozen Delivery 与 Runtime Input
Delivery 均不查询或验证 Camp legacy View state。legacy locator/View 数据无法解析时，只记录不含路径和内容的
`legacy_locator_unavailable` 诊断并省略该引用；不得让同一 Context、v2 Message 或 Run 失败，也不得转为逐文件探测。

新 Run 的 Runtime authorization 只绑定已准入 Runtime Files Root identity、精确 Camp `attachments` root、workspace
不重叠和 root containment，使用稳定的 `live_append_v1` root compatibility；Scheduler 不取得 legacy View read
admission、不检查 unresolved writer intent，也不在 dispatch 前触发 legacy rebuild。legacy publication 的 mutation
gate、recovery 与 generation 只服务升级前遗留 operation，不能成为新 Run 的前置条件。

显式 preview/open/reveal 是独立安全动作，必须在动作前重验 exact Camp/attachment、路径、节点类型和 receipt；
它们的失败不扩大 Context 热路径。

## Legacy v1

历史 `message_attachment`、Authority、View catalog、resolution ledger、generation、publication operation 和
`projection_blocked` Delivery 均保持原身份，且不批量迁移、不双写。Legacy View verifier 忽略保留的
`.managed-v2` child，其 catalog 与 generation 只描述 legacy entries。现有兼容 reconciler 可以收口旧未完成
operation；新 v2 intent 永不进入它。

历史 Camp 可继续打开、加载旧消息、发送新 v2 消息和运行 Agent。新 Context 不为缺失 legacy/v2 文件增加逐项
磁盘探测；损坏或未完成的 legacy View 最多使对应旧引用不进入新 Context，不能阻断 v2-only Run。Camp 删除仍先
执行既有 Runtime process fence，然后清理同一 Camp root 中的 legacy View 与 v2 payload；
备份必须保留仍受支持的 legacy Authority/View 和 Runtime Camp root。

## References

- [Camp Attachment v7](../contracts/camp-attachment-v7.md)
- [Camp Composer Draft v5](../contracts/camp-composer-draft-v5.md)
- [Camp Message Send v14](../contracts/camp-message-send-v14.md)
- [Message Delivery v8](../contracts/message-delivery-v8.md)
- [Camp Published Attachment View v4](../contracts/camp-published-attachment-view-v4.md)
- [ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)
- [Runtime Launch and Verification v20](../contracts/runtime-launch-and-verification-v20.md)
- [V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)
- [V1.20-D01](../versions/v1.20/decisions.md#v1-20-d01)
- [V1.17-D01](../versions/v1.17/decisions.md#v1-17-d01)
- [V1.28-D10](../versions/v1.28/decisions.md#v1-28-d10)
- [V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)
- [V1.15-D05](../versions/v1.15/decisions.md#v1-15-d05)
