---
document_type: postmortem
incident_id: INC-2026-08-26-GATHER-COMPLETION-CAUSAL-VISIBILITY
incident_date: 2026-08-26
status: closed
systems:
  - public-a2a-message-delivery
  - durable-gather-barrier
  - agent-run-scheduler
  - camp-open-read-model
  - renderer-conversation-timeline
last_updated: 2026-08-26
---

# Gather 完成投递缺少公开因果展示，导致 A2A 调度误判

> **爱丽丝的小结：** 这次不是奥黛丽悄悄 `@` 我、界面又漏画了标记。她那条公开消息是
> `public_only`，真正叫醒我的是更早那次 Gather 在队员结束后自动生成的“统一综合”投递。
> 系统把工作接回来了，却没把这根因果线画给用户看——花送到了，丝带却藏在盒子里。

## 摘要

2026-08-26，用户在一个真实 Camp 中观察到：奥黛丽发布交付结论后，时间线没有显示 A2A 的
“发送给 @爱丽丝”页脚，但爱丽丝随后开始行动。表面上看，这像是同一条 Agent-to-Agent
消息成功调度、Renderer 却漏画收件人。

只读检查 Camp history、daily database、event log、当前源码与测试后确认，这两个现象属于
两条不同的因果链：

1. 爱丽丝此前用 `team.gather` 向奥黛丽发布了公共请求。请求消息确实有一个
   `public_a2a / forward` Delivery，收件人是奥黛丽；这条消息才属于公开 A2A 寻址。
2. 奥黛丽的交付消息以 `public_only` 发布，正文开头是普通文字“爱丽丝，”，不是结构化
   `@爱丽丝`。该消息的 `effectiveAgentRecipients=[]`、`deliveryIds=[]`，因此不会也不应该绘制
   “发送给 @爱丽丝”，更没有直接唤醒爱丽丝。
3. 奥黛丽的 AgentRun 约 14 秒后成功终结。Gather Item 因没有 captured return，保存了有界
   Runtime final fallback；Barrier 随即创建一条独立的
   `gather_completion / dispatch / required` Delivery，收件人是原始 initiator 爱丽丝。
4. Scheduler 由这条完成投递物化并启动爱丽丝的 `gather_completion` AgentRun。这个系统投递
   没有对应新的公开 CampMessage，也不被加入原请求的公开 recipients；当前 Renderer 只在
   Execution Drawer 把该 Run 标为“统一综合”，不会在时间线画出它与奥黛丽结果之间的因果线。

因此，本次没有发现“公开 A2A 收件人已存在但 Renderer 漏画”的实现回归，也没有发现正文
称呼被误解析后造成越权调度。真正的问题是产品可观测性：公开消息与 Gather 完成投递彼此
独立，系统能据后者继续执行，但普通时间线无法解释这次行动从何而来。用户只能从时间邻近
关系推断因果，且很容易得出错误结论。

本复盘不归咎个人。`public_only` 防止礼貌性结论意外唤醒成员、Gather Barrier 保证 Lead 最终
统一综合、A2A 页脚只展示真实公开收件人，这三项局部规则都合理。缺口产生于没有一个产品
表面把三者组合成用户可理解的完整因果链。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户对照 Camp 时间线与爱丽丝后续行动，发现奥黛丽结果消息没有 A2A 展示 |
| 受影响路径 | Gather 成员结果公开、Barrier completion、Lead continuation 与 Camp 时间线因果展示 |
| 触发条件 | Gather 成员用 `public_only` 发布结果，随后由 AgentRun terminal fallback 使 Barrier ready |
| 用户可见症状 | 结果消息没有“发送给 @爱丽丝”，但爱丽丝进入新一轮执行 |
| 实际调度来源 | 系统创建的 `gather_completion` Delivery，而不是奥黛丽的公开结果消息 |
| 数据完整性 | 未发现 Camp message、Delivery、Gather、AgentRun 或 event log 损坏 |
| 权限影响 | 未发现越权唤醒；完成投递回到冻结的原 initiator Conversation |
| 直接影响 | 用户无法从普通时间线解释行动因果，容易误判寻址、Renderer 或调度行为 |
| 事故状态 | 事实链已确认；产品展示改进尚未实施，由纠正措施继续跟踪 |

## 分析范围与证据状态

- 仓库：Rovai-ai，`main`，分析 revision
  `fbddd414b59e16a38202597499b4b9b775efe48b`。
- 运行证据：用户点名的历史 Camp 的只读 `camp.read`、daily SQLite 与 `event_log`。
- 代码证据：Gather terminal/barrier、Message Delivery materialization、Camp read model、Renderer
  timeline/footer 与相关测试。
- 排除项：没有修改生产实现、Architecture 或 Contract；没有把历史文档的设计声明当作实现证据。
- 未知项：事故时刻的实际 Renderer 截图没有保留。当前快照数据与 Renderer 分支足以确定该
  消息不会生成页脚，但不能回放当时每一个像素或用户滚动位置。

## 关键结论与证据

| 结论 | 状态 | 运行证据 | 代码/测试证据 | 限制或反证 |
|---|---|---|---|---|
| 奥黛丽的交付消息没有公开 Agent 收件人 | 已确认 | Camp sequence 7 的 exact read 为 `effectiveAgentRecipients=[]`；持久记录为 `agentAddressingMode=public_only`、`deliveryIds=[]` | `public_only` 与公开寻址边界见 Camp Message Send；Renderer 只有收到 public delivery 才画页脚 | 正文首词“爱丽丝，”只是普通文本，不是 `@爱丽丝` |
| 该公开消息没有直接启动爱丽丝 | 已确认 | 消息提交于 16:17:06；它没有 MessageDelivery。爱丽丝 Run 的 trigger delivery 是 16:17:20 创建的另一条 `gather_completion` | `settle_item_from_agent_run_terminal` 在成员 Run 终结时结算 Item，并调用 Barrier；`run_barrier` 创建完成投递 | 时间相邻不能证明消息触发 |
| Gather 通过 Runtime final fallback 而非 captured CampMessage 完成 Item | 已确认 | Frozen completion input 中 `capturedMessages=[]`，存在 696 字符 `fallbackSummary`；event 为 `hasCapturedReturn=false, fallbackStored=true` | `gather.rs::settle_item_from_agent_run_terminal` 仅在没有 capture 且 Run succeeded 时保存有界 fallback | 公开结果可能与 Runtime final 内容相似，但 identity 与权威来源不同 |
| 爱丽丝的行动由完成投递启动 | 已确认 | `gather.ready` 后创建 recipient=爱丽丝的 `gather_completion` Delivery；随后物化并 claim 爱丽丝 Run | `gather.rs::run_barrier` 冻结 initiator、Conversation 与 completion input；Dispatch Pump 物化普通 FIFO Run | 该 Run 后来被用户取消，不影响其启动原因 |
| 时间线没有 A2A 页脚符合当前实现与规范 | 已确认 | 结果消息没有 public delivery；completion delivery 也没有公开 recipient presentation | `CampWorkspace` 先按 `deliveryKind === 'public_a2a' && messageId` 过滤；`CampMessageDeliveryFooter` 空集合返回 null；单测只为 public A2A 断言“发送给” | “符合当前规范”不等于用户体验充分 |
| 产品存在执行因果可见性缺口 | 推断（产品判断） | 用户实际把无页脚结果与后续行动理解为同一条隐形 A2A | Architecture 明确当前 V3 无 Gather card/private result surface；Drawer 只把 Run 类型标为“统一综合” | 需要独立 UI/Contract 设计确认最终展示形态 |

## 影响

本次没有造成错误收件人解析、重复公开 Delivery、数据损坏或未授权 Runtime input。奥黛丽的
公开消息按 `public_only` 保持零 Agent recipient；爱丽丝的完成 Run 则回到 Gather 接受时冻结的
原始 initiator Conversation。两条权威边界均按设计工作。

实际影响在于因果解释与用户控制：

- 用户看到“奥黛丽发消息”之后“爱丽丝开始执行”，但时间线没有说明中间存在 Gather Barrier
  与系统完成投递；
- “无 A2A 页脚”在视觉上既可能表示普通公开说明，也可能紧邻一次会自动启动 Lead 的 Gather
  结果，两者不可区分；
- 用户可能误以为正文称呼会隐式寻址，或者 Renderer 丢失了已存在的 recipient；
- 为了“补回”可见因果，用户或 Agent 可能在结果上再显式 `@爱丽丝`，从而改变真实 routing，
  而不是只修展示；
- 支持与诊断人员必须查询 exact `camp.read`、Delivery、Gather 与 AgentRun，才能回答一个本应
  能从产品表面理解的问题。

爱丽丝的完成 Run 于 16:17:21 开始，并在 16:22:55 随 CampTurn cancellation 终止。没有证据
表明该 Run 在取消前发布了新的 Camp 结论；这不改变本次调度与展示缺口的判断。

## 发现与响应

用户先问目标 Camp 中奥黛丽最后面向爱丽丝的消息是否没有渲染 A2A 展示，随后追问既然没
展示，为何仍驱动爱丽丝行动。这两个问题促使调查把“公开 message recipient”与“任意可启动
AgentRun 的系统 delivery”分开检查。

首先用 `camp.read timeline` 与 exact item read 核对历史事实。Sequence 7 的 addressing 明确为空；
正文为“爱丽丝，……”而不是 `@爱丽丝`。Sequence 4 则是爱丽丝发给奥黛丽的真实公开 A2A
请求，存在 `effectiveAgentRecipients=[agent_5]`。

随后只读查询 daily database。原 CampTurn 中共有三条 Run responsibility：爱丽丝的 direct Run、
奥黛丽的 A2A member Run，以及爱丽丝的 `gather_completion` Run。Message Delivery 也分成两条：
sequence 4 对奥黛丽的 `public_a2a / forward / optional`，以及 Barrier 后对爱丽丝的
`gather_completion / dispatch / required`。

Event log 最终给出完整线性化顺序：奥黛丽公开结果提交；成员 Run succeeded；Gather Item 以
fallback 终结；Gather ready；Completion Delivery materialized；爱丽丝 Run queued 并 claimed。
源码和测试进一步证明 Renderer 只会把第一类 public delivery 显示为消息页脚，第二类仅在执行
详情里显示为“统一综合”。

## 时间线

所有时间均为 Asia/Shanghai，由持久 UTC 时间戳转换。用户首次提出复盘的准确观察时间没有
作为结构化事故事件保留。

| 时间 | 事件 |
|---|---|
| 2026-08-26 15:28:02 | 用户要求爱丽丝在确认方案后让奥黛丽制作 HTML 设计稿。 |
| 2026-08-26 15:31:29 | 爱丽丝通过 `team.gather` 发布 sequence 4 的公共请求；Core 创建发给奥黛丽的 `public_a2a / forward` Delivery 与 GatherRecord。 |
| 2026-08-26 15:31:30 | 奥黛丽的成员 AgentRun 被 claim。 |
| 2026-08-26 16:17:06 | 奥黛丽以 `public_only` 发布 sequence 7 的交付结论，正文以普通文本“爱丽丝，”开头；该消息 recipient 与 delivery 均为空。 |
| 2026-08-26 16:17:20.910 | 奥黛丽 AgentRun succeeded。 |
| 2026-08-26 16:17:20.913 | Gather Item 以 `hasCapturedReturn=false, fallbackStored=true` 终结；Barrier 写入 `gather.ready`。 |
| 2026-08-26 16:17:20.920 | Dispatch Pump 物化发给爱丽丝的 `gather_completion` Delivery 与完成 Run。 |
| 2026-08-26 16:17:21.792 | 爱丽丝完成 Run 被 claim；Execution Drawer 可将其标为“统一综合”。 |
| 2026-08-26 16:22:55 | 用户取消原 CampTurn；Gather、完成 Run 与完成 Delivery 随之取消。 |
| 2026-08-26，时间未结构化记录 | 用户注意到消息页脚与实际行动不一致，并要求解释和复盘。 |

## 技术根因

### 调度有两种权威事实，时间线只展示其中一种

公共 A2A 的用户可见模型是：

```text
CampMessage
  + public_a2a MessageDelivery × recipient
  -> 消息下方“发送给 @成员”
```

Gather completion 的执行模型则是：

```text
成员 AgentRun terminal
  -> GatherItem terminal
  -> Barrier CAS + frozen completion input
  -> gather_completion MessageDelivery
  -> initiator completion AgentRun
```

后者仍使用 Message Delivery queue 与 Scheduler，却不是一条公开 Agent addressing。它没有新的
CampMessage、没有 public recipient presentation，也不能冒充 sequence 7 的收件人。当前 Read
Side 有意不把 completion 加入原请求 recipients，Renderer 则只为 `public_a2a` Delivery 生成
“发送给”页脚。这样保证公开消息事实准确，却让系统续跑的因果从普通时间线消失。

### 结果公开与 Gather capture 是正交机制

奥黛丽的 `public_only` send 只负责发布公共 CampMessage。它会绕过 inline Agent addressing，
即使正文包含类似 Agent 名称的文字，也不会创建 Delivery。Gather 是否继续并不依赖这条公开
消息；成员 AgentRun 进入终态时，Gather Item 必须终结。若没有精确 captured return，Core 会
把 Runtime final output 作为有界 fallback 存入冻结 completion input，然后正常启动 Lead 完成 Run。

本次正好走了 fallback 分支：sequence 7 可见，但不是 Barrier 选中的 captured message；真正进入
completion input 的是 Runtime final fallback。把 sequence 7 看成“发给爱丽丝并驱动她”的消息，
同时混淆了 publication、capture 与 scheduling 三个不同事实。

### 用户界面缺少跨对象的因果投影

Execution Drawer 能根据 `AgentRun.invocationKind` 显示“统一综合”，但消息 timeline 不展示
GatherRecord、GatherItem 或 completion relation。用户既看不到“这条成员 Run 的终结已使 Gather
ready”，也看不到“爱丽丝正在执行的是原请求的系统统一综合，而非新收到一条 A2A”。这是本次
系统性缺口。

## 促成因素

### 时间邻近造成强因果暗示

公开结果与完成 Run 只相隔约 15 秒，且两者正文都围绕同一交付。没有系统标记时，把前者当成
后者 trigger 是最自然的解释。

### 普通称呼与结构化寻址在视觉上不够可区分

结果以“爱丽丝，”开头，表达面向某人，但没有 `@`、Structured Member Mention 或 Delivery。
正文语气提供了“收件人”暗示，UI 却只通过页脚表达规范收件人；用户需要知道内部 addressing
规则才能理解差异。

### Gather V3 有意没有独立结果 surface

当前架构明确写明 V3 没有 Gather card 或 private result surface，Read Side 也避免把 completion
加入公开请求 recipients。这减少了 UI 对象数量，却留下 completion causality 无处展示。

### 测试分别验证事实，没有验证组合叙事

Renderer 单测证明 public A2A 消息会显示“发送给”，Execution Drawer 也能把
`gather_completion` 标为“统一综合”。但没有端到端 fixture 同时包含 public-only 成员结果、
fallback、completion delivery 与 Lead Run，再断言用户能辨认实际因果。

### 诊断 event 名称与产品概念不完全一致

Agent 的 recipient-free send 仍记录在公共 A2A publication seam 中；若只看宽泛 event 名称而不
检查 `agentAddressingMode`、`recipientFree`、`effectiveRecipients` 与 `deliveryIds`，也可能误把
publication event 当成 routing evidence。

## 既有防护为何没有阻止事故

- `public_only` 正确阻止了 Agent 名称文本被解析并调度；它保护了执行边界，却不解释随后的
  Gather continuation。
- Exact `camp.read item` 正确分开投影 `effectiveAgentRecipients`；普通用户时间线没有展示同等
  精度的 addressing mode 与系统 completion relation。
- Gather Barrier 正确冻结结果并创建且仅创建一个 required completion responsibility；其完成
  投递属于 orchestration，不属于公开消息 recipient。
- Renderer 的 A2A footer 严格来自 `public_a2a` Delivery，避免伪造收件人；但没有第二种视觉语义
  表达“已汇入统一综合”。
- Execution Drawer 的“统一综合”标签只说明 Run 类型，不把它连接回成员终结、结果消息或原始
  Gather request。
- 既有测试防止错误渲染单个对象，却没有防止跨对象的因果不可见。

## 不属于根因的事项

- 不是 Renderer 丢失了一条已存在的 sequence 7 A2A Delivery；该消息从未有 Delivery。
- 不是 Core 把普通“爱丽丝，”或隐藏的 `@爱丽丝` 解析为寻址；正文中没有 `@`，且 send mode
  为 `public_only`。
- 不是奥黛丽直接 forward 或 return 给爱丽丝；爱丽丝 Run 的 invocation kind 是
  `gather_completion`，不是 `a2a`。
- 不是 Default Lead 变更后重新解析 recipient；完成投递使用 Gather 接受时冻结的 initiator
  Conversation。
- 不是消息投影、FTS 或历史读取遗漏 recipient；exact read、数据库 message row 与 Delivery row
  彼此一致。
- 不是数据损坏或重复调度；只创建了一条完成投递和一条完成 Run。

## 解决与恢复

本次调查完成了事实恢复与文档澄清，没有修改生产行为：

1. 通过 exact Camp read 确认 sequence 7 是 recipient-free `public_only` message。
2. 通过 MessageDelivery、GatherRecord/GatherItem、AgentRun 与 event log 还原真实调度链。
3. 通过 frozen completion input 确认此次使用 Runtime final fallback，而不是 captured CampMessage。
4. 通过 Renderer source 与单测确认无 footer 是当前代码的确定性结果，而非偶发渲染失败。
5. 把“公开寻址”和“系统统一综合续跑”作为不同语义写入本复盘，避免未来修复错误地把
   completion 伪装成 message recipient。

产品层面的可见性缺口仍需单独设计和实现。任何修正都必须保留两条权威：不得给 sequence 7
伪造 `effectiveAgentRecipients`，也不得让 Renderer 通过重新解析正文决定 routing。正确方向是
新增可验证的 Gather causal projection 与独立展示语义。

## 做得好的地方

- Core 的 `public_only` 边界阻止普通称呼意外触发 Agent。
- Gather completion 使用冻结 initiator Conversation，没有依赖当前显示名或正文解析。
- Event log、Delivery、Run 与 frozen input 保留了足够证据，可在没有截图的情况下还原因果链。
- Exact `camp.read` 直接暴露 `effectiveAgentRecipients=[]`，快速排除 public recipient 丢失。
- Renderer 没有为 system completion 伪造公开“发送给”事实。

## 可以改进的地方

- Camp timeline 应能区分“普通 Agent 公开说明”和“已使 Gather 进入统一综合的成员完成”。
- 完成 Run 的入口应能定位回原 Gather request，并说明它不是一条新的公开 A2A。
- 若展示成员结果与 completion 的关系，必须标注数据来源是 captured message 还是 Runtime fallback。
- Read model 应提供稳定、结构化且无需正文推断的 Gather causal relation，供 Renderer 使用。
- 测试应覆盖 public-only result + fallback + completion Run 的完整真实组合。
- 诊断界面应在不暴露用户内容的前提下显示 delivery kind、dispatch disposition、gather identity
  与 trigger relation。
- 事故与用户观察时间应保留为结构化里程碑，避免仅能从邻近 event 推断。

## 幸运之处

- 公开消息与系统完成投递的持久 identity 完整，没有真正的数据歧义。
- `public_only` 让称呼保持普通文本，没有因解释误差制造第二条 Agent Delivery。
- 完成投递只回到原 initiator，且进入同一 recipient FIFO、capacity 与 cancellation 边界。
- 用户及时追问“为何行动”，使问题没有被简单归类成 Renderer cosmetic bug。

## 纠正与预防措施

状态反映本复盘发布时可用的证据。开放事项在实施前需要由当前版本规划与相关
Architecture/Contract/UI 权威确认；本复盘本身不创造产品规范。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| GCV-01 | 用 exact Camp read、Delivery、Gather、AgentRun、frozen input 与 event log 还原本次真实因果链 | Collaboration Diagnostics | P0 | 已完成 | 本复盘“关键结论与证据”与“时间线” |
| GCV-02 | 为 Read Model 定义结构化 Gather causal projection，能关联 request、Item terminal/result source、completion delivery 与 completion Run，且不改写 public recipients | Collaboration Architecture | P1 | 已计划 | 目标：单独 Architecture/Contract 设计审查 |
| GCV-03 | 在 Camp timeline 或相邻执行表面增加区别于“发送给”的统一综合提示，并能定位原请求与完成 Run | Camp Renderer | P1 | 已计划 | 目标：UI brief、accessibility 与窄屏评审 |
| GCV-04 | 增加端到端回归：成员 `public_only` 结果、无 captured return、fallback、Barrier ready、Lead completion Run；断言公开 recipient 仍为空但因果可见 | Core + Renderer Testing | P1 | 已计划 | 目标：read-model 与 Renderer integration fixture |
| GCV-05 | 在诊断投影中展示脱敏 `deliveryKind`、`dispatchDisposition`、`gatherId` 与 trigger relation，避免只凭 event 名称判断 routing | Core Observability | P2 | 已计划 | 目标：diagnostics contract review |
| GCV-06 | 为协作产品验收加入“可从普通界面解释任意新 AgentRun 的直接用户/A2A/Gather 来源”检查 | Product Acceptance | P2 | 已计划 | 目标：Camp execution causal-visibility checklist |

## 复发判据

在可见性修正交付后，出现以下任一情况即视为本事故复发：

- `gather_completion` Run 已启动，但普通产品界面无法把它与原 Gather request 建立因果联系；
- UI 把 system completion 伪装成某条 recipient-free CampMessage 的“发送给”recipient；
- Renderer 通过正文名称或 `@` 文本重新推断 Gather recipient，而不是消费 Core 结构化事实；
- 使用 Runtime fallback 时，UI 声称某条 CampMessage 被 capture；
- public-only 成员结果与 Lead continuation 时间相邻，用户仍只能通过 exact DB/CLI 检查才能解释
  行动来源；或
- 回归测试只覆盖 public A2A footer 或 Drawer label，未覆盖两条因果链的组合。

如果一条消息本来就没有 public recipient，因此不显示“发送给”，这本身不是复发。复发条件是
系统续跑的真实因果仍不可见，或为了可见而篡改了公开消息事实。

## 经验

“谁能看到这条消息”“这条消息发给谁继续工作”与“某个聚合流程结束后系统该唤醒谁”是三个
不同问题。它们可以发生在相邻时间、谈论同一交付，却由不同的持久事实拥有。产品不能靠
用户从时间顺序猜出三者关系。

准确的 UI 不只是避免展示错误事实，还要让重要的真实因果可以被理解。对 Gather completion
而言，正确修复不是给结果消息补一个假的 `@爱丽丝`，而是明确展示：成员工作已经终结，
结果以何种来源进入 Barrier，系统正在让原 initiator 做统一综合。

## 参考资料

- [Public A2A Message 与 Message Delivery 架构](../architecture/public-a2a-message-delivery.md)
- [持久 Gather Barrier 架构](../architecture/durable-gather-barrier.md)
- [Gather v3 合同](../contracts/gather-v3.md)
- [Message Delivery v5 合同](../contracts/message-delivery-v5.md)
- [Camp Message Send v12 合同](../contracts/camp-message-send-v12.md)
- [Gather Item terminal 与 fallback 实现](../../crates/rovai-core/src/gather.rs)
- [Message Delivery Dispatch Pump](../../crates/rovai-core/src/message_delivery.rs)
- [Camp Read Model](../../crates/rovai-core/src/read_model.rs)
- [Camp timeline、A2A 页脚与“统一综合”标签](../../apps/desktop/src/renderer/src/CampWorkspace.tsx)
- [Public A2A footer Renderer 测试](../../apps/desktop/src/renderer/src/App.test.ts)
