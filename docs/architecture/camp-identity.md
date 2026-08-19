---
document_type: architecture
authority: camp-identity-boundaries
last_updated: 2026-08-20
---

# Camp Identity Architecture

本架构组合 [ADR-0219 的迁移后决定正文](../versions/v1.10/decisions.md#adr-0219)与
[Camp Identity v1](../contracts/camp-identity-v1.md)，说明唯一 Camp identity 在创建、持久化、模型输入、工具、
本机路径与 Native Session 之间如何流动。字段级格式与拒绝规则归 Contract；选择理由归版本决定。

## Identity flow

```text
Camp creation
  └─ CampId::new (UUIDv7 → canonical Crockford Base32)
      ├─ camp.id / every camp_id foreign key
      ├─ Core read/write models and Desktop campId
      ├─ SHARED_CONVERSATION and Context evidence
      ├─ Built-in Camp/Task outputs and Camp History targets
      └─ Rovai-owned camp-attachments / codex-homes path component

CampId
  └─ Conversation
      └─ Native binding
          └─ provider Native Session / Thread / Turn ID
```

Camp identity 和 Native identity 是串联关系，不是同一命名空间。Runtime resume 只读取 Conversation binding；
Camp API、Camp path 和 Agent-facing Camp locator 只接受 `rvcamp_...`。

## Component responsibilities

- `CampId` value type 拥有生成、canonical parse、Serde、SQLite、Display 和 FromStr；调用者不能自行拼接前缀。
- Collaboration 创建事务生成唯一主键；所有 Camp 关系继续使用 `TEXT camp_id` 和既有外键。
- Desktop Core 参数与领域命令反序列化在查询、授权或路径计算之前拒绝非 canonical 值。
- Renderer 只用共享 `isCampId` 恢复本机导航、onboarding、pin 与 timeline state；无效旧状态被丢弃。
- Context Formatter、Camp History 与 Built-in catalog 共享同一 Camp ID 语义，但各自通过版本化合同冻结 wire。
- `camp.read` CLI 的 Timeline 默认只补全 read shape；显式或从当前 Binding 解析出的 CampId 仍经过同一
  canonical parse 与 live authorization，不因默认读取方式改变 identity scope。
- Attachment 与 Runtime-managed home 先解析 Camp ID，再把 canonical value 当作单一路径组件。
- Conversation/Runtime 层保留 provider-native ID，不从 Camp ID 推导、补全或猜测 Session ID。

## Persistence and clean break

Migration 94 先安装 Runtime public failure schema 49；Migration 95 再安装 Context Formatter 20 / schema 50。
生产打开旧预发布本地数据时，Core 将不兼容的 Rovai-owned database/files 移入
`inactive-data-quarantine/` 后建立当前 store，不生成 `old UUID → CampId` 映射。schema 49 到 50 的显式迁移
同时清除旧 Manifest、Bootstrap/Delivery evidence、Native binding 和 accepted boundary，并失败关闭非终态
Run、Turn、Delivery 与 Gather。

本机 Renderer storage 也采用版本 clean break：timeline storage v2 与 Camp-aware navigation/onboarding state
只恢复 canonical Camp ID。丢弃旧 locator 不删除任何外部 Runtime Session。

## Stable boundaries

- Camp 表、API、Agent Context、工具、事件和路径中的 `campId/camp_id` 都指同一个 CampId。
- 标准 UUID、uppercase、非 canonical Crockford alias、非 UUIDv7 payload 和错误 variant 一律无效。
- Native Session/Thread/Turn/Conversation ID、Agent ID、Task ID、Run ID 与其他实体格式不变。
- Camp ID 是 locator，不是授权 token；每个读写入口继续执行当前 membership、fence、revision 与 actor 检查。

## References

- [Camp Identity v1](../contracts/camp-identity-v1.md)
- [ContextManifest Evidence v19](../contracts/context-manifest-evidence-v19.md)
- [Camp History Retrieval v4](../contracts/camp-history-v4.md)
- [Built-in Tool Transport v17](../contracts/builtin-tool-transport-v17.md)
- [AgentRun Recovery](agent-run-recovery.md)
- [Built-in Tool Runtime](builtin-tool-runtime.md)
