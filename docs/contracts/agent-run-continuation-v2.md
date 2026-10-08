---
document_type: protocol-contract
contract: agent-run-continuation-v2
authority: user-authorized-independent-run-continuation
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-10-08
---

# AgentRun Continuation v2

继承 [v1](agent-run-continuation-v1.md) 的按次授权、命令幂等、独立 Run、完整原输入集合、当前上下文、
Task/成员准入及唯一 Delivery lane。本版替代新会话确认和续做专属的恢复失败阻断规则。

## 会话自动选择

点击继续即授权本次新执行；前端提交 `{threadId, agentRunId}`，不弹出会话确认。
`useNewSession` 仍作为兼容字段接受，true 强制选择新会话；省略/false 表示自动选择，不表示禁止降级。
Core 不再返回 `agent_run.new_session_confirmation_required`，也不因排队期间会话兼容性变化制造失败 Run。

请求先持久化；旧执行清理和工作区隔离门禁通过后，领取时按最新事实决定是否必须清除绑定：

- 已发送、已接受或结果未知的旧输入没有可信 native turn 终态时，自动选择新会话。
- 同一当前绑定之后已有匹配 epoch、binding generation 和 native turn ID 的可信原生终态时，
  更早的未知结果不再强制换会话。业务失败也可以证明原生 turn 已结束，但会话损坏、协议不兼容、
  缺失结束结果等错误不在此列。仅接受输入、其他绑定或更早的终态均不足；历史事实不改写。
- 其他兼容性由现有 Runtime 的 Compatible / Controlled / New 路径拥有。仅 installation generation
  变化或兼容 key 缺失仍允许既有受控恢复；明确安装身份、绑定摘要或兼容 key 冲突按现有规则选择新会话。
- 历史 `continuation_session_unavailable` 事件不再作为永久准入条件；实际恢复结果由当前启动判断。

## 投递前恢复降级

沿用 ACP / Pi 已有的会话启动降级；Codex 用户续做在 `thread/resume` 失败后允许一次 `thread/start`。
降级必须在本次业务输入可能被接受之前，保留工作区，轮换绑定并按现有 builder 构建新会话输入。
Codex 检查当前 Run/epoch、取消状态及输入投递事实；已 dispatch、accepted 或 unknown 时禁止此回退。
新会话启动再失败则明确结束，不循环尝试，不复制已投递输入。认证、模型/权限校验和执行期失败保留实际错误。
ACP 恢复成功后的模型/配置 RPC 失败不属于会话恢复失败。Claude / Antigravity 先完成原生初始化、
确认会话身份，再冻结 ContextManifest 并由 Core 释放本次输入；明确缺失会话且未投递时才允许一次降级。
Antigravity 使用支持 stream-json stdin 的原生版本提供这一门禁；旧版本的 argv 投递保持一次性语义，
不能在未知接受情况时补发。
替代启动失败且本次没有任何可能投递时保留旧 Session 引用；不恢复旧绑定凭证，不覆盖已建立的新会话。
降级复用既有 continuity-lost 事件，不新增恢复协调器、队列、证据摘要或模型提示字段。

图标、提交中禁用、未知响应复用 commandId、来源状态不变与可多次点击沿用 v1。
工作区、Task、旧 Run/Manifest/接受记录始终保留；业务效果不承诺恰好一次。
详见 [Accepted Input Recovery v8](accepted-input-recovery-v8.md)、
[Runtime Launch v53](runtime-launch-and-verification-v53.md) 和 [Surface v46](run-process-detail-surface-v46.md)。
