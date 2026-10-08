---
document_type: protocol-contract
contract: accepted-input-recovery-v7
authority: accepted-runtime-input-failure-and-execution-isolation
status: accepted
version: 7
source_version: v1.72
last_updated: 2026-10-07
---

# Accepted Input Recovery v7

继承 [v6](accepted-input-recovery-v6.md) 的未知结果失败结算、原冻结投递不重放、late ACK fencing、
进程清理和 lane／工作区隔离。本版以 [AgentRun Continuation v1](agent-run-continuation-v1.md) 替代
“没有业务继续 API／按钮”的产品限制，增加 User 显式授权的新执行。

新授权允许引用原业务消息，但不是将 accepted/unknown Runtime Input Delivery 复制、换 ID 或改成未执行。
旧 Run、Manifest、接受记录保持终态和原值；每个新请求拥有独立的命令事实和 Delivery，新 Run 创建自己的
Manifest 与投递身份。自动运输恢复仍只限同一 Run 中可证明 not_accepted 的冻结输入。

用户确认新会话不能代替清理证明；继续始终等待现有隔离门禁。原 native turn 结果未知时默认新会话，除非
Adapter 已证明其结束。续做实际恢复失败后必须结束当前尝试，不得隐式空会话回退。
