---
document_type: contract
name: Runtime Launch and Verification
version: v53
status: accepted
source_version: v1.72
last_updated: 2026-10-08
---

# Runtime Launch and Verification v53

继承 [v52](runtime-launch-and-verification-v52.md)。本版仅调整用户主动续做的 Native Session 激活失败处理，
不改变安装、认证、模型、权限、一般运输恢复和输入接受后的边界。

[AgentRun Continuation v2](agent-run-continuation-v2.md) 复用正常 Runtime 兼容判断及 ACP/Pi 已有降级路径，
不再用续做专属 guard 拦截会话启动。Codex 的用户续做在恢复失败且本次业务输入尚未发送时，
允许同一次执行创建一次新 Thread，重新绑定并构建现有 bootstrap；随后业务输入只投递一次。
新建也失败则结束。普通 Codex 执行的精确恢复失败仍按既有规则报错，不扩大为通用自动重试。

旧执行清理、当前 Run/epoch/取消栅栏及 accepted/unknown 输入不重放保持；记录既有
`agent_run.native_session_continuity_lost`，不新增持久恢复系统或模型提示词。
