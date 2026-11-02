---
document_type: protocol-contract
contract: context-delivery-profile-v15
status: accepted
version: 15
source_version: v1.72
last_updated: 2026-10-17
---

# Context Delivery Profile v15 / v16

继承 [context-delivery-profile-v14](context-delivery-profile-v14.md) 未被下述条款替代的规则。

新 public Profile **15** 保持 v14 的预算与最多 8 项 Task；能力关闭则不查询、选择或渲染 Task section。新 non-batch Profile **16** 继承 Profile 12 预算，Single Chat 不提供 Task。能力值与输入冻结一致；预算裁剪与输入重放不按后来的设置重新计算。

冻结 Profile 4–14 保留原解析/摘要；当前新版本及准入见 [ContextManifest v43/v42](context-manifest-evidence-v43.md)。

聊天Bot新增CHAT_REPLY_CONTEXT计入claim预览与最终UTF-8总量，完整来源和正文不可为适应预算而删减；可能缩小FIFO批次或减少可选Task，Profile15字段与数值均保持。新public43、旧40恢复及Steer配对见Manifest43。
