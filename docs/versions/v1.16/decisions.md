---
document_type: version-decisions
version: v1.16
lifecycle: current
last_updated: 2026-08-20
---

# v1.16 决策记录

本文件只解释 v1.16 的重要取舍；当前字段与行为规范由 Architecture、Contracts 与 UI 直接拥有。

<a id="v1-16-d01"></a>

## V1.16-D01：ready 附件可以独立构成用户消息 payload

### 背景

v0.25 建立持久 Composer Draft 时禁止纯附件消息，理由是附件本身不足以表达用户意图，且 AgentRun purpose
依赖正文。产品现已把 Prepared Attachment 明确建模为用户在 exact Draft 中排序、检查并主动发送的私有编辑
事实；成功事务又把它原子转换为 Camp-wide Published Attachment。继续要求额外正文会迫使用户输入无信息量
占位文字，而自动生成“请查看附件”则会伪造用户表达。

现有 Context、Attachment View 和 AgentRun 已能表达这种输入：`CURRENT_INPUT.message` 是字符串，附件使用正式
Runtime View 路径，AgentRun purpose 是独立字段。因此真实取舍是允许 ready 附件成为显式 payload，还是继续
用正文存在性代理用户意图，而不是增加新的消息或附件架构。

### 决定

用户 exact Draft 在“渲染正文 trim 后非空”或“至少存在一个当前 Camp、`state = ready` 的 Prepared
Attachment”时可发送。两者同时为空才以兼容错误码 `camp_message.empty_body` 拒绝；preparing、failed 或其他
非 ready 项不能满足附件条件。

纯附件消息逐字保存 `body = ""` 和 `structured_content_json = "[]"`，并通过既有同一事务完成 CampMessage、
`message_attachment`、CampTurn、AgentRun 与 Draft consume。任何 publication、consume 或事务失败仍全部回滚，
不得先发布空消息后异步绑定附件。

Desktop 对这种执行请求提供稳定事实性 AgentRun purpose `Camp attachment-only message`，但它不是用户正文、
不进入 `camp_message.body`，也不替换 `CURRENT_INPUT.message`。Timeline 只省略空正文气泡，继续展示消息外壳、
作者、时间、回复入口和附件卡。

本决定局部替代 [ADR-0080](../v0.25/decisions.md#adr-0080) 的 Decision 5 与“允许纯附件消息”被拒绝方案；
其 Core-owned Draft、限制、exact ordered set、原子消费、失败保留和不生成占位正文等其余边界继续有效。

### 后果

- ready 附件本身成为用户确认发送的明确 payload，正文不再是唯一准入代理；
- 消息、附件、publication、consume、Dynamic Context 与 AgentRun 数据结构和版本轴均不改变；
- `CURRENT_INPUT.message` 可以合法为 `""`，同时 `attachments` 包含正式发布路径；
- 发送按钮和所有程序化 submit 入口必须共享同一判断，不能只放宽视觉控件；
- 首条纯附件消息不从附件名生成标题，回复摘要和消息搜索也不增加附件名回退。

### 被拒绝方案

- 自动生成“[附件]”或“请查看附件”正文：会把系统文字伪装成用户表达，并污染 Context、搜索和摘要；
- 允许任何 Prepared Attachment 状态满足发送：会把准备中或失败项当成已确认 payload，破坏 exact Draft；
- 先提交空 CampMessage、附件完成后再绑定：产生部分公共事实并越过现有原子事务；
- 放宽 AgentRun purpose 为空：扩大既有执行合同，而固定事实性 purpose 已能保留当前架构；
- 同时用附件名生成标题、回复摘要或搜索命中：这些是独立产品选择，不应借发送准入隐式引入。

### 当前权威影响

- [Camp Composer Draft v3](../../contracts/camp-composer-draft-v3.md)
- [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)
- [Composer Draft 与用户发送不变量](../../architecture/foundational-invariants.md#camp-composer)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)

