---
document_type: architecture
authority: camp-identity-boundaries
last_updated: 2026-08-27
---

# Thread Identity Architecture

本架构组合 [ADR-0219 的迁移后决定正文](../versions/v1.10/decisions.md#adr-0219)与
[Camp Identity v1](../contracts/camp-identity-v1.md)，说明唯一 Thread identity 在创建、持久化、模型输入、工具、
本机路径与 Native Session 之间如何流动。字段级格式与拒绝规则归 Contract；选择理由归版本决定。

## Identity flow

```text
Thread creation
  └─ ThreadId::new (UUIDv7 → canonical Crockford Base32)
      ├─ camp.id / every camp_id foreign key
      ├─ Core read/write models and Desktop threadId
      ├─ RUN_INPUT, RUN_FACTS and Context evidence
      ├─ Built-in Thread/Task outputs and Thread History targets
      └─ Rovai-owned camp-attachments / codex-homes path component

ThreadId
  └─ Conversation
      └─ Native binding
          └─ provider Native Session / Thread / Turn ID
```

Thread identity 和 Native identity 是串联关系，不是同一命名空间。Runtime resume 只读取 Conversation binding；
Thread API、Thread path 和 Agent-facing Thread locator 只接受 `rvcamp_...`。

## Component responsibilities

- `ThreadId` value type 拥有生成、canonical parse、Serde、SQLite、Display 和 FromStr；调用者不能自行拼接前缀。
- Collaboration 创建事务生成唯一主键；所有 Thread 关系继续使用 `TEXT camp_id` 和既有外键。
- Desktop Core 参数与领域命令反序列化在查询、授权或路径计算之前拒绝非 canonical 值。
- Renderer 只用共享 `isThreadId` 恢复本机导航、onboarding、pin 与 timeline state；无效旧状态被丢弃。
- Context Formatter、Thread History 与 Built-in catalog 共享同一 Thread ID 语义，但各自通过版本化合同冻结 wire。
- `thread.read` 省略 `messageId/replyChain` 时直接选择 timeline；显式或从当前 Binding 解析出的 ThreadId 仍经过
  同一 canonical parse 与 live authorization，不因读取形状改变 identity scope。
- Attachment 与 Runtime-managed home 先解析 Thread ID，再把 canonical value 当作单一路径组件。
- Conversation/Runtime 层保留 provider-native ID，不从 Thread ID 推导、补全或猜测 Session ID。

## Persistence and recovery

数据库打开、升级与阻断遵循 [Database authority](availability-first-runtime.md#database-authority-state-machine)：
支持的旧库在原库迁移；未知合同、损坏或歧义保留原数据并明确阻断，不能通过隔离或重置创建替代库。
Thread 改名不重写既有 ID、外键或路径，不生成 `old UUID → ThreadId` 猜测映射。

本机 timeline、navigation 与 onboarding locator 只恢复 canonical Thread ID；丢弃失效 locator
不删除数据库记录或任何外部 Runtime Session。

## Stable boundaries

- 公开 `threadId`、SQL `camp` 表主键、`camp_id` 外键和本机路径都使用同一个 ThreadId。
- 标准 UUID、uppercase、非 canonical Crockford alias、非 UUIDv7 payload 和错误 variant 一律无效。
- Native Session/Thread/Turn/Conversation ID、Agent ID、Task ID、Run ID 与其他实体格式不变。
- Thread ID 是 locator，不是授权 token；每个读写入口继续执行当前 membership、fence、revision 与 actor 检查。

## References

- [Camp Identity v1](../contracts/camp-identity-v1.md)
- [ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)
- [Camp History Retrieval v4](../contracts/camp-history-v4.md)
- [Built-in Tool Transport v20](../contracts/builtin-tool-transport-v20.md)
- [AgentRun Recovery](agent-run-recovery.md)
- [Built-in Tool Runtime](builtin-tool-runtime.md)
