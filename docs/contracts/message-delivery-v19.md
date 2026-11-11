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

## 持久化原生 inbox 的复用保护

OpenCode 的 `resume: false` 只关闭唤醒；输入仍先持久化。活跃检查与入队之间可能发生结束，
`injected` 不能证明输入已由原轮消费，停止或回收进程也不能证明 inbox 已清空。
上游依据为 [v2.2.7 Steer 实现](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/turn.ts#L406-L423)
和 [Session 合同](https://github.com/anomalyco/opencode/blob/v2.2.7/specs/v2/session.md)。

保护从既有 `begin_runtime_input_dispatch` 准入事务的 `dispatch_started_at` 开始派生：
同一精确原生 Session 中，存在已准入且尚未明确 not_accepted 的 Steer 输入，就不能自动用于后继 Run。
身份沿用投递账本的 Native Binding／generation，以及既有 `conversation.native_session_bound` 事件中的
Session ID 与存储兼容身份；更换 Host、程序升级、重绑相同 Session 或 Core 重启均不解除风险。
明确未接收只排除对应输入；原 Run 成功、另一条拒绝或后续可信终态不清除其他输入的 inbox 风险。

本期不新增逐项原生消费／清理接口。存在上述风险时，完成原有执行 cleanup 后，普通 FIFO 领取清除
当前恢复绑定并沿现有新 Session 分支启动；已有 queued Run 的恢复选择也复查该保护。
不持续阻塞整个 Conversation，不自动重投旧输入，不删除原消息、回执或原生历史，也不发送空 Prompt 消耗 inbox。
Session 轮换隔离后续输入；旧执行产生效果的能力仍由原有 cleanup 门禁负责。

以上直接复用原投递账本、绑定事件、新 Session 分支和 Fleet；无 Schema 迁移、专属队列、
专属输入状态、持久化能力目录或额外模型输入。
