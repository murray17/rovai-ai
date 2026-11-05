---
document_type: contract
name: Runtime Launch and Verification
version: v76
status: accepted
source_version: v1.72
last_updated: 2026-11-04
---

# Runtime Launch and Verification v76

继承 [v75](runtime-launch-and-verification-v75.md)。本版补齐 CodeBuddy 原生拒绝终态的错误描述，
复用 TRAE 等 ACP Runtime 已有的错误解析、脱敏、公开 failure 与 RunCard 展示链路。

## ACP Provider detail

共享 JSON-RPC error 继续保留数字 `code` 与字符串 `message`。Provider detail 按顺序取字符串
`data`、`data.error`、`data.details`、`data.message`；只取首个存在的字符串，清洗后为空或与
顶层 message 相同则不追加。对象、数组、非字符串和其他路径不作为 detail，不递归搜索或序列化
完整对象。`data.details` 明确现有实现，`data.message` 补齐 CodeBuddy 的原生错误封装。

## CodeBuddy Prompt result

仅对已通过当前 Host、Run、epoch、Session 和 Prompt 归属校验，且 `stopReason=refusal` 的
CodeBuddy completion，读取精确路径 `result._meta["codebuddy.ai/errorMessage"]`。
该字段必须是至多 64 KiB 的 JSON 字符串，解析后的对象必须有非空字符串 `message`；
其余字段仅由上述共享 JSON-RPC error 解析器读取。此例外只解析该原生终态字段，
不解析普通 `error.data` 中的 JSON，也不读取任意 update、Tool 或 stderr。

缺失、类型错误、非法 JSON、超限及没有有效 message 时，保留现有通用 refusal 描述。
其他 Runtime，以及 `end_turn`、`cancelled`、未知终态不使用此元数据补充原因。
实际 JSON-RPC error 的现有描述优先，原生 refusal 仍失败，不将其改成成功或未接受输入。

## 公开展示与结算

详情进入现有 `RuntimeFailureView.detail` 前，沿用凭据、路径、控制字符、Prompt/Tool 标签行、
行数与字符上限清洗；不公开整个元数据对象。错误分类沿用共享分类器，Renderer 不自行归因。
RunCard 继续使用现有安全详情区域，优先展示 detail，缺失时显示 summary，不新增界面或错误字段。

输入接受、错误终态、Action、Approval 和防重放语义保持。原生已接受本轮输入时，
即使 Provider 错误可重试，公开 failure 的 retryable 仍受 Core 原有门禁限制。
不增加自动重试、状态、数据库 Migration 或历史回填。
