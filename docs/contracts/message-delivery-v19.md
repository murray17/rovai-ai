---
document_type: protocol-contract
contract: message-delivery
version: 19
status: accepted
authority: public-message-delivery-route-reconciliation
source_version: v1.72
last_updated: 2026-11-10
---

# Message Delivery v19

继承 [v18](message-delivery-v18.md)。本版增加 OpenCode 官方 ACP Steer；其他 Runtime、普通队列、
消息正文、Context Builder、Formatter、Bootstrap 和既有输入状态保持原义。

## OpenCode 资格与通道

Core 按目标 Run 冻结的程序身份、版本、协议和实际 Native Binding 判断资格。
`opencode-cli` 在 `acp-v1` 上仅开放稳定版本 `2.2.7 <= version < 3.0.0`。
Steer 版本格式接受完整三段 SemVer、可选 `v`／`opencode ` 前缀和合法 build metadata；
不完整、非法后缀、预发布、未知版本和未纳入兼容范围的 major 保守排队。
严格格式检查仅用于 OpenCode Steer，数字比较和版本门槛复用公共逻辑；不提高普通运行的最低版本，
不改变其他 Runtime 的解析或普通执行兼容性。成员设置或磁盘升级不能改变已启动 Run 的冻结资格。

`canSteer` 与 `ready` 保持分离：启动期先保存原 Delivery 意图，当前绑定的初始输入取得 accepted 证据后才发送。
符合上述版本资格的 OpenCode 复用共享 ACP 的当前 Prompt 模型／工具活动确认初始接收；
catalog、历史重放和 user echo 不作为接收证据，旧版本普通输入确认保持原行为。

Host initialize result 顶层 `/_meta/steering/supported` 必须严格为 boolean `true`，否则明确未提交。
沿当前 Host、Session 和 ACP 连接调用 `_session/steering`，params 为
`{sessionId, prompt: [{type: "text", text: runtime_payload}]}`。
Run／epoch／Host／Session／原 Prompt 的归属校验保持；独立 RPC ID 不替换原 Prompt，不新建 Run，
不使用第二个 `session/prompt` 或取消重启模拟插话。前端消费现有资格／回执，不维护版本表或用户开关。

## 逐条回执与收尾

| 精确关联的结果 | 处理 |
| --- | --- |
| reader 在原 Prompt 终态前观察到 `outcome: injected` | accepted，仅证明原生接收，不证明消费或完成 |
| `outcome: promptRequired, reason: noRunningTurn` | 明确未接收；包括原 Prompt 已结束后到达的该精确拒绝 |
| 写入前目标失效或 Host 未声明能力 | 明确未提交，复用原有回队列路径 |
| 请求发出后超时、断连、无法解释的结果或其他未证明未接收的错误 | delivery_unknown，不自动重发 |
| 原 Prompt 结束后才观察到、无法确认归属的 injected | 保持 delivery_unknown，不绑定后继 Run |

回执归属使用同一 reader 顺序。ACK 先于终态时，等待方调度延迟不能抹去已接收事实；
补充请求的结果不拥有原 Prompt 的终态。按原 Delivery 顺序取得逐条接收回执后可继续下一条，
不等待模型消费或回复。正文中的停止要求不转换为宿主取消命令。

自然结束先由 PromptCompleted 关闭新准入，再在已发送 RPC 原有期限内有界收口后回收 Host。
沿用 10 秒写入、写入后 45 秒响应期限，不重置或延长期限。
Stop 继续原有取消流程，不等待 ACK；取消 fence 唤醒自然收尾等待。
超时后移除本期在途关联并保留 unknown，不增加长期迟到回执追踪或自动核对服务。

## Native Session 连续性与原生消费边界

可用性与会话连续性沿用现有 Runtime 原则。正常插话后的后继 Run 在兼容且可恢复时继续原 Native Session；
accepted、delivery_unknown 或已开始发送的 Steer 账本条目本身不清空绑定、不强制新建 Session。
Session 恢复仍遵守既有兼容性、恢复失败和通用输入未知处理，不增加 OpenCode 专属的 Session 风险准入。

Host 生命周期与 Native Session 连续性分别处理：使用过插话的 Host 按共享 ACP／Fleet 规则收尾回收，
保留 Conversation 的原生 Session ID 和 Binding，后续可由新的 Host 恢复同一 Native Session。
现有执行 cleanup 仍负责停止旧执行及其进程效果；其完成不作为清空原生 inbox 的证明。

OpenCode 的 `resume: false` 只关闭唤醒，输入仍先持久化。活跃检查与入队之间可能发生结束，
原生已接收输入可能留在 inbox，并在同 Session 的后续执行中消费；本接入接受这一原生语义，
不承诺严格由原生同一轮消费。上游依据为
[v2.2.7 Steer 实现](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/turn.ts#L406-L423)
和 [Session 合同](https://github.com/anomalyco/opencode/blob/v2.2.7/specs/v2/session.md)。

Rovai 的逐条接收事实仍属于发送时的 Run／epoch；accepted 与 unknown 输入不由 Rovai 自动重发或复制到普通队列。
明确未接收才按既有回队列规则处理。原生在恢复后的同 Session 消费已有输入，与 Rovai 再投一次该输入是两个事实。
不为结束边界增加专属隔离、自动核对、逐项 inbox 撤销、历史搬运或空 Prompt 排空机制。

以上继续复用现有 Delivery、Context、ACP、Native Binding 与 Session 恢复路径；
无 Schema 迁移、专属队列、专属输入状态、持久化能力目录或额外模型输入。
