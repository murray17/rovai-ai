---
document_type: protocol-contract
contract: accepted-input-recovery-v8
authority: accepted-runtime-input-failure-and-execution-isolation
status: accepted
version: 8
source_version: v1.72
last_updated: 2026-10-08
---

# Accepted Input Recovery v8

继承 [v7](accepted-input-recovery-v7.md) 的原投递不可重放、旧终态/证据保留、late ACK fencing、
清理和 lane/工作区隔离。User 点击继续已经授权新的执行，不再单独要求新会话确认。

按 [AgentRun Continuation v2](agent-run-continuation-v2.md) 自动选择会话：旧 native turn 结果未知时
默认新会话；后续同一绑定、epoch 与 native turn 匹配的可信原生成功或非会话失效失败终态，
可以消除更早未知结果对会话选择的影响，不改写旧结果。普通 failed 状态和 cleanup ACK 本身均不足。
实际会话恢复失败可在本次新输入尚未投递时做一次有界新会话降级；替换失败仍结束本次执行。
本次输入已经或可能被接受后，不得通过换会话再次发送。换会话不替代旧进程清理证明。
普通运输恢复仍只允许原合同的 not_accepted 输入，不因本次产品交互改动扩大。
