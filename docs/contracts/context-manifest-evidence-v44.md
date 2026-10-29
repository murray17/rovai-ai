---
document_type: protocol-contract
contract: context-manifest-evidence-v44
status: accepted
version: 44
source_version: v1.72
last_updated: 2026-10-29
---

# ContextManifest Evidence v43 / v44

继承 [v40/v42](context-manifest-evidence-v42.md)。新 public 初始输入和 Steer 使用 Formatter/Manifest
43、Run Facts 11、Delivery Profile 15；新 non-batch 使用 44、Run Facts 13、Profile 16。
变化仅为 [Message Quotes v2](message-quotes-v2.md)：引用模型项只含 kind/text，证据保留 quoteId/text，
被引用来源不参与过滤。承载消息的权限、选择与预算保持。

Migration 218 将 projection schema 167 → 168，复用现有表重建扩展版本约束、配对与新输入准入。
不改写历史 Manifest、Blob、Claim、Quote 或 Delivery 行；失败整体回滚。
旧引用用于未来请求时读取保存文本，旧冻结输入恢复使用原字节及原证据。

Charter revision 26 仅删除 Single Chat 中已经失效的 quote.source 字段说明；其他 Charter 文字不变。
Bootstrap formatter 6、Binding compatibility 16、Run Facts 与 Profile 语义不变，不新增版本轴。
