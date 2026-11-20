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

继承 [v18](message-delivery-v18.md)。OpenCode 官方 ACP Steer 沿用下述资格和回执。公共消息改删复用普通队列和
Run 停止流程。Context Builder、Formatter 和 Bootstrap 继续读取调度已领取的输入。

## 公共消息改删

`thread.messages.edit` 和 `thread.messages.delete` 使用现有命令信封。编辑以 `expectedContentRevision` 比较内容，
同时保存结构化正文、保留附件 ID 与本次准备的来源附件。内容修订号从 1 开始，只在有效内容变化时递增。正文、提及和附件未变时返回 unchanged。
成员和广播目标只来自结构化提及。没有结构化提及时选当前有效队长。会话没有队员时只保存。

一次命令提交内容变更、旧投递结算和替换投递。编辑保持消息 ID、时间线顺序和回复关系。删除清除当前正文与附件，保留消息身份和关系。
旧 Run 保留领取时的输入版本和附件引用。新 Run 按现有停止及资源隔离规则领取有效输入。
只有直接包含旧普通输入的活跃 Run 整批取消，其余有效普通输入自动重新合批。已结束的 Run 保留原结果。
插话已送达或本次投递已结束且未确认送达时，删除消息不停止纯插话接收 Run。实际在途的插话暂缓删除。
正式绑定过插话后始终不可原地编辑。已回队列的投递遵循当前普通投递关系。

未领取的普通投递使用消息与目标标识等待项，改版时更新同目标等待项。移除未领取的目标不关闭撤回资格。
首次普通领取或实际插话绑定后，撤回资格单向关闭。

用户继续后由普通投递重排。等待中的输入随消息改版或改投，被中断的批次将其余有效普通输入送回各自队列。
每个队员按消息顺序领取，已领取的历史显示其原有冻结清单。见 [AgentRun Continuation v5](agent-run-continuation-v5.md)。
新版普通输入按领取时的内容修订号输出可选 `edited`。见 [ContextManifest v45](context-manifest-evidence-v45.md)。
已发生的执行效果保留，重新处理可能产生新的回复。

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
