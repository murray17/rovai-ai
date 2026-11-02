---
document_type: architecture
architecture: public-a2a-message-delivery
authority: public-message-delivery-and-agent-run-boundaries
status: accepted
last_updated: 2026-10-31
---

# Public Thread Message、Delivery 与 AgentRun

本架构定义公开 Thread 的统一消息执行主链。字段合同见 [Camp Message Send v29](../contracts/camp-message-send-v29.md)、
[Message Delivery v18](../contracts/message-delivery-v18.md)、[ContextManifest v43/v44](../contracts/context-manifest-evidence-v44.md)
与 [Camp History v17](../contracts/camp-history-v17.md)。Single Chat 不使用本主链。

## 三类事实

```text
public ThreadMessage
  └─ waiting Delivery × explicit target
       └─ Scheduler claims one FIFO prefix
            └─ immutable multi-input AgentRun
                 ├─ AgentRunInput × N
                 ├─ frozen ContextManifest
                 └─ Runtime input / execution evidence
```

- `ThreadMessage` 是公共内容、作者、顺序、锚点、引用和附件的唯一事实。
- `Delivery` 是一个目标 Agent 对该消息的待处理责任，是等待队列的唯一事实。
- `AgentRun` 是一次实际执行；它只在 claim 成功后创建，并冻结本次输入和执行配置。

三者不能互相冒充：公开消息没有“所有目标已完成”的全局状态；Run 结束只说明一次执行结束；Task、Mission、
Automation occurrence 与 ChannelDelivery 继续由自己的业务状态结算。ThreadTurn 只保留历史读取，不参与新执行。

## 发布与寻址

Core 在同一事务中验证作者、Thread membership、显式目标、self-send、正文/结构化内容、附件和命令幂等，随后写入一个
公共消息，为每个目标幂等建立 `kind = camp_member` Conversation 路由，再创建一条 waiting Delivery。
`--public-only` 只发布消息。多个目标共享消息内容，但没有预算、额度、Gather 或通用完成集合。发布不创建 Run；
Conversation 只承担后续 lane 与 Native Session 的稳定路由身份。

Anchor 只表达默认回复展示关系，不能推导目标、caller return、权限或完成。Agent 发言通常继承所属 Run 的冻结 anchor；
用户显式回复使用自己选择的 anchor。Core 不再维护 forward/return、root、depth、ancestor cycle 或 A2A 预算；只有
self-send 继续拒绝。显示名兼容解析若仍存在，只在发送事务内解析为 canonical Agent ID，后续队列不重新解析正文。

自动上下文投影不会改变这条路由权威。`addressMode = default` 且只有一个冻结接收者时，Core 在新 public
AgentRun 的 `RUN_INPUT` 正文前派生该接收者的 Member Mention，并随 Manifest
evidence 冻结显示名和精确 bytes；claim 事务把当时的显示名保存到对应 AgentRunInput，避免 claim 后改名造成
投影漂移，并同时冻结该 RunInput 的 context version。用户保存正文、Structured Content、实时 Thread Read/Search、Quote、FTS、
Channel 与 Renderer 均保持原样；显式目标不重复添加，public-only 不添加，非法默认目标状态 fail closed。

## Delivery-first 调度

每个 `(ThreadId, AgentId)` 有一条按消息 sequence 排序的 waiting Delivery 队列。等待阶段不创建 queued Run，也不冻结
Runtime 配置。Scheduler 获得执行资格时，在一个事务中：

1. 幂等补建历史 waiting lane 缺失的 Thread-member Conversation；只处理仍 active/present 的目标；
2. 分别检查当前 membership、同一 Thread+Agent 旧执行隔离，以及实际共享 executionRoot 的清理门禁；
3. 读取当前 Runtime、模型、模式、工作区、工具与权限配置；
4. 准备本 Run 的 Bootstrap 与动态上下文快照，用本次 Runtime payload capacity 和正式 `RUN_INPUT.messages[]` 投影/序列化结果，从队首选取能完整交付的
   最大连续前缀，不跳过任何中间项；每条消息按自身 ID 投影正文、quotes、source attachments 与 Skills；
5. 在同一事务内用上次有效接受边界、本次公屏尾、最终选择的全部输入 ID 和当前 Agent，对可见公屏历史做无分页上限的 `EXISTS`；排除已选输入和自己写的消息，查询失败回滚 claim；完整 `historyHint` 文本纳入容量预算；
6. 创建一个 batch AgentRun 和有序 AgentRunInput，在 Run 内冻结该边界和额外消息判断；
7. 以最后一条输入作为 Run anchor，同事务保存 claim 上下文快照和实际执行配置；后续物化使用相同内容；
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
获准的既有 Run，不领取新 Delivery。legacy 500ms maintenance 循环及其启动注册已经退出。
Single Chat Pending 接续与 non-batch Run 由自己的提交后通知推进，Runtime preparation 纳入 Core 既有任务集合，
不占住普通 batch wake、fallback 或 worker completion 的协调循环。Automation、执行预算和文本收尾只在各自
业务 deadline 或实际失败的 retry deadline 到期时重验。既有低频资源回收仍保留，不承担正常消息推进。

必要 `RUN_INPUT` 优先于可选 Self Active Tasks。`RUN_FACTS.historyHint` 计入完整 payload 预算。队首单条也超过当前 Runtime profile 时，Core 创建明确的 preflight-failed Run，
不向 Runtime 发送截断内容，并让队列随后继续。完整选择规则见 [Profile 13](../contracts/context-delivery-profile-v13.md)。同包 Bootstrap 按本 Run 实际冻结内容预留完整补发空间，避免领取后 Memory 更新或 Session 更换使预算不足。未领取消息保持 waiting；已领取 Run 不重新拆批。

## 可见性与撤回

本地 User Composer 消息在所有目标仍未 claim 时可撤回。首个目标 claim 原子关闭撤回资格。
已发布消息在 claim 前可由显式 `thread.read`、`thread.search` 和 `history.search` 读取；主动查询不领取 Delivery 或关闭撤回资格。已 claim 目标通过 `RUN_INPUT` 接收；未 claim 的目标仍不从 RUN_INPUT 取得该消息正文。撤回成功取消所有 waiting Delivery 并擦除 Rovai 活跃数据中的原文；Agent 后续 `thread.read` 只返回 `Message withdrawn` 状态项，搜索不再命中。

人类执行台读取与 Agent-facing 上下文隔离不同：Thread Open 把未 tombstone 消息关联的当前
`camp_message_delivery` 全部投影到 `messageDeliveries`，不按消息作者过滤。用户消息没有 `sourceAgentRunId` 仍是
同一 waiting 队列事实；Renderer 可在 claim 前显示只读排队卡。完整字段与 coverage 边界见
[Camp Open Projection v25](../contracts/camp-open-projection-v25.md)，展示见
[Run Process Detail Surface v46](../contracts/run-process-detail-surface-v46.md)。

RUN_INPUT 沿用冻结输入可见性；显式 read/search 使用 [History v17](../contracts/camp-history-v17.md) 的主动查询可见性。
公共 Thread 历史对所有受认证队员可读；membership 只控制参与、寻址与执行，不是历史 ACL。
已保存 quotes 按承载消息的权限投影 kind/text，不重读或过滤来源，见 [Message Quotes v2](../contracts/message-quotes-v2.md)。
ContextManifest 冻结当前输入和 discovery 时序证据，但 `thread.read` 按调用时最新状态解析存续 Thread，
不受 Manifest 上下界限制。

## 终态、停止与恢复

Run 终态按输入 Delivery 分别写入 `settled | failed | cancelled`。普通 Stop 以精确 `agentRunId + version` CAS，只停止被点击
的 Run；它不暂停 lane，不取消 waiting Delivery，也不能误停 successor。User 继续入口按 [AgentRun Continuation v4](../contracts/agent-run-continuation-v4.md) 提交新的独立授权。Runtime 明确未接受且无
副作用风险时，可以恢复同一冻结 Run 的运输；accepted/unknown 永不作为未执行重新投递。

Run 显示失败不等于旧执行已隔离。Scheduler 在 claim 前分别检查同一 Thread+Agent 的旧执行隔离和实际共享
executionRoot 的旧执行清理；任一未确认时，后继 Delivery 保持 waiting 且不创建新 Run。unknown 默认换新 Native
Session，但换 Session 不能替代旧进程清理。

## Channel 与 Automation

Channel 入站在消息和 Delivery 提交后即完成接收。绑定 Channel 的 Thread 中，每条 Agent 公共消息创建独立、可去重的
ChannelDelivery；outbox 失败不重跑模型。Automation admission 创建 started occurrence、新 Thread、首消息和 Delivery，
再走普通 claim；已有 active occurrence 时直接 `skipped(overlap)`，没有 queued occurrence。

## 历史切换

Migration 163 把尚未进入冻结/accepted Runtime input 的旧公开等待责任转成新 waiting Delivery，并终态化旧的可变 Run
占位。Migration 166/schema 116 扩展新 public Formatter/Manifest 27 与 Profile 8，并在 AgentRunInput 增加
context version 与 nullable 的 claim-time 接收者显示名快照；既有 RunInput 回填 v26，因此升级时已经 claim、
尚未 materialize 的 Run 也保持 Profile 7。消息表不回写，冻结 v26/Profile 7 Run exact replay。历史 Run、
ThreadTurn、Gather、Manifest 与 evidence 原样只读；冻结或
outcome-unknown 输入绝不重新入队。

Migration 172/schema 122 只扩展新公开 Formatter/Manifest 29、Profile 9 与 Run Facts 7 的写入约束，
保留旧业务行及审计原字节。旧格式执行不再继续派发或恢复，也不转换、双读或自动重播；需要继续工作时
建立新执行，必要时使用新 Session。新格式 Run 的 `historyHint` 和输入保持冻结。

## 正文 User 寻址

Agent Send 在共享解析模块识别行首连续提及中的稳定 `@User`，并与显式 `mentionUser` 合并为当前用户结构化身份。
PublicOnly 只抑制 Agent 路由，仍允许用户提及；通知沿用当前原子、消息局部和幂等投影。显示名称由当前用户资料解析，
不持久化到身份字段。兼容别名见 [User Naming v1](../contracts/user-naming-v1.md)。精确位置、排除规则与未改变的 Runtime final/quote 来源见 [Send v25](../contracts/camp-message-send-v25.md)。

## 公开执行查询

[Thread Runs v1](../contracts/thread-runs-v1.md) 由 `thread_runs` 只读模块拥有：复用 `camp_history` 的实时目标解析与消息正文投影，
同一事务中筛选公共 Run、聚合 waiting Delivery 并生成预览。Single Chat Run 先从候选集排除；私有调用方沿用封闭 policy。
公开结果统一为 items，不暴露内部来源分类；未形成 Run 的队列条目仅以 null agentRunId 和 queued 表达。
输入数量使用全部冻结关联，首条预览按 ordinal；队列使用当前队首，不保证未来一次 claim 会处理整组。
本查询不建立快照分页、缓存或调度管理机制；动态页间变化按命令说明保留明确限制。

用户主动继续复用此队列，但单独成批，普通消息合批不跨过续做请求；旧 Run 与旧投递终态不变。

### claim 前的 Mission 工作区准备

新 public batch 先由现有 Mission workspace owner 异步准备真实执行目录、读取实际 Git branch，
再把完整 WORKSPACE 计入选批快照。每 Thread 至多一个准备任务；普通 lane 可继续领取和派发。
SQLite claim 事务只复核准备结果的 workspace ID、generation、preparation token、目录和当前
成员／Delivery 准入。结果过期则保留 waiting 并重新发现，不使用源 checkout 猜测输入。
历史 queued Run 保持执行准备边界；Mission cleanup 与删除继续使用既有 workspace lifecycle gate。

## 用户运行中插话

User 的发送操作可以选择 Steer，正文仍只有普通 ThreadMessage，责任仍由逐队员 Delivery 拥有。
Core 在发布时捕获可用的目标 Run／epoch，Scheduler 复用既有 worker；只在 Runtime 层选择 start
或向当前受管执行补充输入。多目标分别处理，普通 waiting 队列不被抽走；支持附件、引用与 Skill。

共同 DynamicInputContext Builder 和 Formatter 只读本次来源，新输入读取最新动态事实；启动内容、
执行配置、Bootstrap 和已物化输入保持冻结。Manifest 可以一 Run 多条，ACK、恢复和历史 fence 关联
精确 Manifest。正常结束时可证明未提交的来源回普通队列；未知不重放，取消不自动启动后继。
当前支持 Codex、Claude Code、Pi、CodeBuddy、Qwen Code、MiniMax Code、Grok Build、Kiro CLI、ZCode、TRAE CLI CN、Hermes，运输和回执见
[Message Delivery v18](../contracts/message-delivery-v18.md)。Qwen 只通过原生拉取回调投递；
CodeBuddy 的补充响应不结束原 Run。Pi 的精确 RPC queued 响应确认接收，不等待消费。
CodeBuddy/Grok 缺少原生 turn 参数，以 Run/epoch/Session fence 和执行后 Host 回收限制迟到输入；
Pi 的原生未消费队列同样不能带入后继 Host。上下文、消息正文和逐队员 Delivery 保持共同路径。

Kiro 以当前 Prompt 的逐请求 queued 回执确认，ZCode 以原 Turn 的精确 guide queued 事件确认；
消费事件不阻塞回执或下一条投递。ZCode 仍跟踪未 drained 的 guide 并在结束时清理。
使用过插话的 Host 不带入下一次复用。插话不自动中止已运行的阻塞工具，不改变普通动态上下文。

资格统一由 Core 按目标 Run 的冻结安装、版本和协议判断，UI 消费 canSteer 与原因，发送前复查。
普通任务资格独立；未知版本或不满足回执要求时普通排队，未知投递结果不重发。accepted 的共同展示
为“运行时已接收”，不等同模型消费或业务完成。TRAE 使用 `_session/steering` 的 injected 回执，
原 Prompt 仍拥有终态，使用过插话的 Host 回收。

Claude 复用 Stream JSON 和既有输入编号关联回显，允许确认跨越内部 result；接收不承诺原生同轮。
回执不决定 Run 生命周期，可靠结束后未确认输入单独保持未知，不重发、不阻塞收尾。
Hermes 复用官方 ACP slash Steer；原生来晚转下一轮时，Core 在同一 Run 内跟踪已提交请求到完成。
原请求先返回但补充请求尚未结束时，保留活动绑定、CLI 授权及事件归属；最后统一收尾。
已知结束不再补充，普通 waiting 消息仍由原队列启动；不新增映射表或 Gateway 管理通道。
已确定且支持插话的启动 Run 先保存 Delivery 意图，初始输入接受后再由同一 Scheduler 物化／投递；
等待只新增既有 Delivery 归属，不新增正文。启动时补全缺失版本须核验实际冻结程序身份，普通运行资格保持。


Run 执行窗口中的插话位置由 Core 在上述路由事务中记录，记录仅引用 Message／Delivery，
不另存正文、附件或回执快照。读取时从原归属投影内容与当前回执，沿用执行窗口 change cursor 原位刷新；
Renderer 将输入作为工具组边界。字段与旧数据行为见 [Delivery v18](../contracts/message-delivery-v18.md#执行窗口中的输入标记)。
