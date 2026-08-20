---
document_type: version-overview
version: v1.16
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-20
---

# Rovai-ai v1.16：Camp 纯附件消息

> 当前状态：设计、Core、Desktop、Timeline 与回归门禁已完成，等待主线同步和 macOS 日常安装交接。
>
> 前置版本：[v1.15 Windows x64 产品实现与资格闭环](../v1.15/README.md)。v1.15 已按其未完成
> Windows 验收事实冻结为 historical；其已实施的 macOS、Runtime Attachment View、Context receipt 与
> execution console 语义继续作为本版基线。

## 版本目标

让用户可以在 Camp Composer 中只发送一个或多个已经 ready 的附件而不伪造正文。正文与 ready 附件都为空时
继续拒绝；附件准备中或失败、接收者需要修复、Camp 正忙等既有阻断保持不变。

## 交付范围

- Core 从 exact Draft 先渲染正文、再读取当前 Camp 的 ordered ready Prepared Attachment；只有两者同时为空
  才返回兼容错误码 `camp_message.empty_body`；
- accepted 纯附件消息持久化 `body = ""`、`structured_content_json = "[]"`，并在同一事务消费完整附件、创建
  `message_attachment`、CampTurn 与 AgentRun；
- Desktop 的 submit guard、App send guard 和发送按钮共享“非空正文或至少一个 ready 附件”判断，同时保留
  preparing、failed、busy、submitting、Draft 缺失和 recipient repair 门禁；
- Desktop 在纯附件执行请求中使用稳定事实性 purpose `Camp attachment-only message`，只满足既有 AgentRun
  非空 purpose 合同，不写入 CampMessage 或 `CURRENT_INPUT.message`；
- Timeline 保留消息外壳、作者、时间、回复与附件卡，只在正文非空时渲染正文气泡；
- Core、Renderer 与 Context 回归覆盖 ready/non-ready、原子回滚、空正文持久化和正式 Runtime View 路径。

## 数据与 Context 兼容性

本版不增加数据库 Migration，继续使用 Data Contract `v1.15 / projection schema 56 / Migration 101`。不修改
`camp_message`、Prepared/Message Attachment、Published Attachment View、publication transaction、
`contentDigest` 或 AgentRun 数据结构。

`CURRENT_INPUT` 的字段、选择、Formatter 21、ContextManifest 21、Run Facts v2 与 Profile v4 均不改变：
`message` 继续忠实投影触发 CampMessage 的正文，因此纯附件消息为 `""`；`attachments` 继续使用正式发布后的
稳定 Runtime View 路径。本版只让既有可表达的空字符串与附件组合通过业务发送门，不改变模型上下文合同，
因此不触发独立 model-context revision 或版本升级。

## 明确不做

- 不按附件文件名搜索消息；
- 不用附件名回退回复摘要；
- 不用首条附件文件名生成 Camp 标题；
- 不伪造“[附件]”“请查看附件”等正文；
- 不异步把附件绑定到已发布空消息；
- 不修改附件 publication、consume、Attachment View、事务边界或运行期 generation fence。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.15 按实际未完成范围冻结为 historical；本概览、实施计划和版本索引建立唯一 current v1.16。 |
| Decisions | 已更新 | [V1.16-D01](decisions.md#v1-16-d01)记录 ready 附件可独立构成用户发送 payload，并局部替代 v0.25 的纯附件禁止条款。 |
| Contracts | 已更新 | [Camp Composer Draft v3](../../contracts/camp-composer-draft-v3.md)冻结 sendability、空正文持久化、原子失败与 execution purpose 边界。 |
| Architecture | 已更新 | Composer Draft 架构与基础不变量明确正文/ready 附件联合准入，保持 publication、consume、AgentRun 和 Context 结构不变。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)统一 submit/button 门禁，并规定纯附件时间线不渲染空正文气泡。 |
| Runtime Activity | 确认无需更新 | 不新增 Runtime activity、Evidence 或状态映射。 |
| Runtime compatibility | 确认无需更新 | Published Attachment View 路径、Runtime 授权和 generation-fenced 兼容模式不变。 |
| Documentation routing | 已更新 | 文档导航、Contract 索引、决定导航、Composer Architecture、UI 与版本入口切换到 v1.16/v3。 |
| Root README | 确认无需更新 | 这是既有 Camp Composer 的局部发送能力，不改变项目定位、平台支持或常青安装说明。 |

## References

- [v1.16 实施与验收计划](implementation-plan.md)
- [v1.16 决策记录](decisions.md)
- [Camp Composer Draft v3](../../contracts/camp-composer-draft-v3.md)
- [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)
- [Camp Attachment v2](../../contracts/camp-attachment-v2.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
