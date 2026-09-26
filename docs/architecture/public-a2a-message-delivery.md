---
document_type: architecture
architecture: public-a2a-message-delivery
authority: public-message-delivery-and-agent-run-boundaries
status: accepted
last_updated: 2026-09-24
---

# Public Camp Message、Delivery 与 AgentRun

本架构定义公开 Camp 的统一消息执行主链。字段合同见 [Camp Message Send v24](../contracts/camp-message-send-v24.md)、
[Message Delivery v10](../contracts/message-delivery-v10.md)、[ContextManifest 30](../contracts/context-manifest-evidence-v30.md)
与 [Camp History v10](../contracts/camp-history-v10.md)。Single Chat 不使用本主链。

## 三类事实

```text
public CampMessage
  └─ waiting Delivery × explicit target
       └─ Scheduler claims one FIFO prefix
            └─ immutable multi-input AgentRun
                 ├─ AgentRunInput × N
                 ├─ frozen ContextManifest
                 └─ Runtime input / execution evidence
```

- `CampMessage` 是公共内容、作者、顺序、锚点、引用和附件的唯一事实。
- `Delivery` 是一个目标 Agent 对该消息的待处理责任，是等待队列的唯一事实。
- `AgentRun` 是一次实际执行；它只在 claim 成功后创建，并冻结本次输入和执行配置。

三者不能互相冒充：公开消息没有“所有目标已完成”的全局状态；Run 结束只说明一次执行结束；Task、Mission、
Automation occurrence 与 ChannelDelivery 继续由自己的业务状态结算。CampTurn 只保留历史读取，不参与新执行。

## 发布与寻址

Core 在同一事务中验证作者、Camp membership、显式目标、self-send、正文/结构化内容、附件和命令幂等，随后写入一个
公共消息，为每个目标幂等建立 `kind = camp_member` Conversation 路由，再创建一条 waiting Delivery。
`--public-only` 只发布消息。多个目标共享消息内容，但没有预算、额度、Gather 或通用完成集合。发布不创建 Run；
Conversation 只承担后续 lane 与 Native Session 的稳定路由身份。

Anchor 只表达默认回复展示关系，不能推导目标、caller return、权限或完成。Agent 发言通常继承所属 Run 的冻结 anchor；
用户显式回复使用自己选择的 anchor。Core 不再维护 forward/return、root、depth、ancestor cycle 或 A2A 预算；只有
self-send 继续拒绝。显示名兼容解析若仍存在，只在发送事务内解析为 canonical Agent ID，后续队列不重新解析正文。

自动上下文投影不会改变这条路由权威。`addressMode = default` 且只有一个冻结接收者时，Core 在新 public
AgentRun 的 `RUN_INPUT` 正文前派生该接收者的 Member Mention，并随 Manifest
evidence 冻结显示名和精确 bytes；claim 事务把当时的显示名保存到对应 AgentRunInput，避免 claim 后改名造成
投影漂移，并同时冻结该 RunInput 的 context version。用户保存正文、Structured Content、实时 Camp Read/Search、Quote、FTS、
Channel 与 Renderer 均保持原样；显式目标不重复添加，public-only 不添加，非法默认目标状态 fail closed。

## Delivery-first 调度

每个 `(CampId, AgentId)` 有一条按消息 sequence 排序的 waiting Delivery 队列。等待阶段不创建 queued Run，也不冻结
Runtime 配置。Scheduler 获得执行资格时，在一个事务中：

1. 幂等补建历史 waiting lane 缺失的 Camp-member Conversation；只处理仍 active/present 的目标；
2. 分别检查当前 membership、同一 Camp+Agent 旧执行隔离，以及实际共享 executionRoot 的清理门禁；
3. 读取当前 Runtime、模型、模式、工作区、工具与权限配置；
4. 用本次 Runtime payload capacity 和正式 `RUN_INPUT.messages[]` 投影/序列化结果，从队首选取能完整交付的
   最大连续前缀，不跳过任何中间项；每条消息按自身 ID 投影正文、quotes、source attachments 与 Skills；
5. 在同一事务内用上次有效接受边界、本次公屏尾、最终选择的全部输入 ID 和当前 Agent，对可见公屏历史做无分页上限的 `EXISTS`；排除已选输入和自己写的消息，查询失败回滚 claim；完整 `historyHint` 文本纳入容量预算；
6. 创建一个 batch AgentRun 和有序 AgentRunInput，在 Run 内冻结该边界和额外消息判断；
7. 以最后一条输入作为 Run anchor，冻结 ContextManifest 和实际执行配置；
8. 把所选 Delivery 原子改为 claimed 并绑定该 Run。

用户、Agent、Mission、Automation 与 Channel 来源使用同一规则，不形成批次边界。新消息不会追加到已冻结 Run。
commit 前崩溃只留下 waiting Delivery；commit 后恢复同一 Run。设置变化影响未 claim 消息，不改变既有 Run。

普通 Delivery 只有一个进程内 Scheduler 协调任务拥有 claim。Core 启动时先执行一次存量检查；该次 claim 会自动修复
旧实现遗留的无 Conversation waiting lane，无需 migration 或维护事件。新 waiting Delivery、
Run 终态、Runtime ready 与相关 cleanup 完成后，在权威事务提交后发送无负载 wake。wake 只表示数据库状态可能变化，
不保存 lane 清单，也不是工作权威。Scheduler 按页继续 claim 和 dispatch，超过单页上限时不会等待下一次定时检查；
Runtime preparation 使用相互独立的 worker，一个慢任务或失败任务不阻塞其他 lane。

协调任务常驻一个不被普通 wake 重置的 30 秒全局兜底。每次兜底先只读检查 waiting Delivery 或尚未 dispatch 的
queued batch Run；空闲时不进入 claim 的写事务。终态处理只结算并 wake，不直接领取 successor；网络恢复只派发已明确
获准的既有 Run，不领取新 Delivery。原 500ms 循环继续承担既有非 batch Run 派发、Automation deadline、取消、
Single Chat 与维护职责，但不再扫描普通 batch 队列，也不能领取普通 Delivery。该旧周期工作运行在独立、串行
且不重叠的维护任务中；慢 Single Chat/non-batch Runtime preparation 不得占住普通 batch wake、fallback 或 worker
completion 的协调循环。

必要 `RUN_INPUT` 优先于可选 Self Active Tasks。`RUN_FACTS.historyHint` 计入完整 payload 预算。队首单条也超过当前 Runtime profile 时，Core 创建明确的 preflight-failed Run，
不向 Runtime 发送截断内容，并让队列随后继续。完整选择规则见 [Profile 9](../contracts/context-delivery-profile-v9.md)。

## 可见性与撤回

本地 Principal Composer 消息在所有目标仍未 claim 时可撤回。首个目标 claim 原子关闭撤回资格。
已发布消息在 claim 前可由显式 `camp.read`、`camp.search` 和 `history.search` 读取；主动查询不领取 Delivery 或关闭撤回资格。已 claim 目标通过 `RUN_INPUT` 接收；未 claim 的目标仍不从冻结输入或 quote-source 投影取得原文。撤回成功取消所有 waiting Delivery 并擦除 Rovai 活跃数据中的原文；Agent 后续 `camp.read` 只返回 `Message withdrawn` 状态项，搜索不再命中。

人类执行台读取与 Agent-facing 上下文隔离不同：Camp Open 把未 tombstone 消息关联的当前
`camp_message_delivery` 全部投影到 `messageDeliveries`，不按消息作者过滤。用户消息没有 `sourceAgentRunId` 仍是
同一 waiting 队列事实；Renderer 可在 claim 前显示只读排队卡。完整字段与 coverage 边界见
[Camp Open Projection v24](../contracts/camp-open-projection-v24.md)，展示见
[Run Process Detail Surface v42](../contracts/run-process-detail-surface-v42.md)。

`RUN_INPUT` 与 quote-source 沿用冻结输入可见性；显式 read/search 使用 Camp History v10 的主动查询可见性。公共 Camp 历史对所有受认证
队员可读；目标 Camp membership 只控制参与、寻址与执行，不是历史 ACL。外层消息可见不代表它引用的 source 可见；
每条 quote snapshot 在投影时按查看 Agent 和边界重新校验 source。ContextManifest 冻结当前输入和 discovery
时序证据，但 Run 内的 `camp.read` 始终按调用时最新状态直接解析存续 Camp，不受 Manifest 上下界限制。

## 终态、停止与恢复

Run 终态按输入 Delivery 分别写入 `settled | failed | cancelled`。普通 Stop 以精确 `agentRunId + version` CAS，只停止被点击
的 Run；它不暂停 lane，不取消 waiting Delivery，也不能误停 successor。产品没有业务重试入口。Runtime 明确未接受且无
副作用风险时，可以恢复同一冻结 Run 的运输；accepted/unknown 永不作为未执行重新投递。

Run 显示失败不等于旧执行已隔离。Scheduler 在 claim 前分别检查同一 Camp+Agent 的旧执行隔离和实际共享
executionRoot 的旧执行清理；任一未确认时，后继 Delivery 保持 waiting 且不创建新 Run。unknown 默认换新 Native
Session，但换 Session 不能替代旧进程清理。

## Channel 与 Automation

Channel 入站在消息和 Delivery 提交后即完成接收。绑定 Channel 的 Camp 中，每条 Agent 公共消息创建独立、可去重的
ChannelDelivery；outbox 失败不重跑模型。Automation admission 创建 started occurrence、新 Camp、首消息和 Delivery，
再走普通 claim；已有 active occurrence 时直接 `skipped(overlap)`，没有 queued occurrence。

## 历史切换

Migration 163 把尚未进入冻结/accepted Runtime input 的旧公开等待责任转成新 waiting Delivery，并终态化旧的可变 Run
占位。Migration 166/schema 116 扩展新 public Formatter/Manifest 27 与 Profile 8，并在 AgentRunInput 增加
context version 与 nullable 的 claim-time 接收者显示名快照；既有 RunInput 回填 v26，因此升级时已经 claim、
尚未 materialize 的 Run 也保持 Profile 7。消息表不回写，冻结 v26/Profile 7 Run exact replay。历史 Run、
CampTurn、Gather、Manifest 与 evidence 原样只读；冻结或
outcome-unknown 输入绝不重新入队。

Migration 172/schema 122 只扩展新公开 Formatter/Manifest 29、Profile 9 与 Run Facts 7 的写入约束，
保留旧业务行及审计原字节。旧格式执行不再继续派发或恢复，也不转换、双读或自动重播；需要继续工作时
建立新执行，必要时使用新 Session。新格式 Run 的 `historyHint` 和输入保持冻结。

## 正文 Principal 寻址

Agent Send 在共享解析模块识别行首连续提及中的稳定 `@Principal`，并与显式 `mentionUser` 合并为当前用户结构化身份。
PublicOnly 只抑制 Agent 路由，仍允许用户提及；通知沿用当前原子、消息局部和幂等投影。显示名称由当前用户资料解析，
不持久化到身份字段。精确位置、排除规则与未改变的 Runtime final/quote 来源见 [Send v24](../contracts/camp-message-send-v24.md)。
