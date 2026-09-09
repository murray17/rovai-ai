---
document_type: version-overview
version: v1.56
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: true
last_updated: 2026-09-09
---

# Rovai-ai v1.56：多段消息选文引用

前置：[v1.55](../v1.55/README.md)。本版本实现 Camp 与私聊的多段消息选文引用。每次选择限定为一条消息的正文；多个部分通过逐次追加进入当前草稿，保存不可变的选文及来源。选文作为讨论材料，与用户本次问题及路由分开。

## 范围与当前状态

已确认 [revision 6 模型上下文变更](model-context-change-partial-message-quotes.md)，Core、Renderer 和 Runtime 链路已实现并通过验收。引用位于输入框内的单行圆角标签区，历史与草稿均默认隐藏具体选文，悬浮显示完整选文，点击整行回跳并以底色定位涉及的完整视觉行。草稿支持直接移除，不提供撤销，移除最后一段后标签消失；复制卡片/文件或跨正文选择不出现入口。Draft、Pending、发布消息、历史与冻结 Context Evidence 共同携带完整有序快照。引用不激活 Mention、Skill、命令或自动派发。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.55 冻结；本概览、[实施计划](implementation-plan.md)、版本索引及前后链接建立唯一 current v1.56 |
| Decisions | 已更新 | [V1.56-D01](decisions.md#v1-56-d01)记录不可变选文与 Reply/路由分离 |
| Contracts | 已更新 | [Message Quotes v1](../../contracts/message-quotes-v1.md)拥有选文、owner、准入与完整投递合同 |
| Architecture | 已更新 | [Message Quotes 架构](../../architecture/message-quotes.md)记录 Core 权威与 Renderer 选择边界 |
| UI | 已更新 | [会话消息引用](../../ui/components/conversation-workspace.md#多段消息选文引用)记录框内紧凑样式、选区排除、悬浮气泡与整行定位 |
| Runtime Activity | 确认无需更新 | 引用不是 Runtime Activity；现有 activity-v4 映射保持 |
| Runtime compatibility | 确认无需更新 | 不新增 Adapter/平台能力；真实 Runtime 输入验证归本版本验收，既有平台资格不变 |
| Documentation routing | 已更新 | 文档入口、Contract、Architecture 和当前决定索引纳入 Message Quotes |
| Root README | 确认无需更新 | 项目定位和支持平台不变，字段与交互由合同及 UI 规范拥有 |

## References

- [实施计划](implementation-plan.md)
- [版本决定](decisions.md)
- [已确认模型上下文变更](model-context-change-partial-message-quotes.md)

后续版本：[v1.57](../v1.57/README.md)。
