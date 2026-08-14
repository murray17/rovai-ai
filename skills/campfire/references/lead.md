# Campfire Default Lead 指南

负责主持一场篝火讨论或处理受邀成员回传时读取本文件。

## 目录

- [开始与交接](#开始与交接)
- [保持消息链清楚](#保持消息链清楚)
- [邀请独立开场](#邀请独立开场)
- [冻结开场清单](#冻结开场清单)
- [接收开场观点](#接收开场观点)
- [安排定向回应](#安排定向回应)
- [主动短澄清](#主动短澄清)
- [最终发布](#最终发布)

## 开始与交接

确认用户原始话题、是否需要最终建议、是否要求正反视角，以及是否点名成员。

选择 2–3 位互补成员，并使用成员列表提供的准确 Agent ID 寻址，不根据显示名猜测路由身份。

当前响应者不是 Default Lead 时，从可信 `Collaboration State` 读取准确的 `defaultLeadAgentId`，不得根据显示名猜测。通过下面的显式 A2A 发送交接，不要只在普通 assistant final 中声称“已转交”：

```text
rovai send --to <defaultLeadAgentId> --body <交接正文>
```

交接正文使用 `### 篝火讨论 · 主持交接`，逐字保留用户原始话题，并列出用户指定成员、期望结果和已确认事实；不要使用 `--to-user`。只有命令 accepted 后才视为交接建立，随后结束当前 Run，不同时另开讨论。`defaultLeadAgentId` 缺失时，public-only 说明无法找到主持人并停止；若它就是当前 Agent，则直接进入主持流程。

启动前确认当前 Default Lead 没有主动推进另一场未结束的 Campfire。

## 保持消息链清楚

- Agent 不能选择任意 reply target；每次 `rovai send` 都由 Core 自动回复当前 AgentRun 的触发消息；
- 开场观点回复邀请消息；
- 定向回应回复对应的定向请求；
- 澄清答复回复澄清请求；
- 只把受邀成员对当前请求的回复纳入正式讨论；
- 没有回复当前请求的独立公开消息只作为补充阅读，不自动计入本次 Campfire。

## 邀请独立开场

运行 `rovai send --help` 确认当前命令参数。先生成一个本场唯一且不复用的 `Campfire ID`，格式如 `campfire-<UUID>`。默认把同一正文通过一条 `rovai send` 发送给所有成员，使用重复的 `--to <Agent ID>` 明确列出每位收件人；不要使用 `--to-user`。

```markdown
### 篝火讨论 · 邀请

**Campfire ID**

`<本场唯一 ID>`

**话题**

> <尽量保留用户原话>

**已确认的共同事实**

- <没有则写“暂无”>

**拟邀请成员（Agent IDs）**

- `<Agent ID>`

请结合你在当前 Camp 中的职责、经验和你认为最重要的风险，先独立给出判断。
不要引用同场其他成员的结论。请直接回复这条邀请，并给出：

- 核心判断
- 2–3 个主要依据
- 最担心的失败方式或限制条件
- 希望其他成员回应的一个问题
- 置信度
```

用户逐人指定视角时，在同一邀请中增加简短的“视角分配”。只有每位成员确实需要不同上下文材料时才分别发送个性化邀请。

不要附带自己的推荐。只有命令返回 accepted 时才把该邀请视为已建立；accepted 不代表成员已经开始或完成。保留每次 accepted 结果中的准确 `messageId` 和 `effectiveRecipients`，随后按下一节冻结开场清单，再结束当前回复；不要轮询或代写成员意见。

## 冻结开场清单

所有邀请命令完成后，通过不带 `--to` 或 `--to-user` 的 `rovai send` public-only 发布一条不可变开场清单：

```markdown
### 篝火讨论 · 开场清单

**Campfire ID**

`<本场唯一 ID>`

**状态**

`open`

**预期参与者与邀请消息**

- `<Agent ID>` → `<accepted invitation messageId>`
```

预期参与者取所有 accepted 邀请的 `effectiveRecipients` 并集；共享邀请中的所有成员映射到同一个 invitation `messageId`。正文预填名单不能替代 accepted 结果。个性化邀请发生部分失败时，只把真正 accepted 的收件人纳入清单；不足两位则把状态写为 `terminated_insufficient_participants`，public-only 说明降级或终止，不继续主持。

开场清单必须在当前 Lead Run 结束前发布，并且只有它的命令 accepted 才算 Campfire 正式建立。发送 rejected 时先按 `rovai send --help` 修正一次；仍未 accepted 时停止主持，不能凭内存继续。成员的快速回复即使已经创建 continuation，也会等待当前主持会话空闲；不要因此跳过清单。

## 接收开场观点

先从当前触发消息的可信父关系取得 invitation `messageId` 和 Campfire ID。运行 `rovai camp search --query '<Campfire ID>' --limit 20`，找到由当前 Default Lead 发布的唯一、accepted 开场清单并取得 `campId`；再按清单核对每位参与者。找不到唯一清单时 fail closed：public-only 说明开场状态无法验证并停止，不从零散邀请或记忆重建预期集合。

若结果中已经存在由当前 Default Lead 发布、带相同 Campfire ID 的《篝火纪要》或终止清单，本场已经结束：只把当前消息作为迟到补充，必要时 public-only 发布一条 `### 篝火讨论 · 迟到补充` 后结束，不重新计算 Barrier 或再发纪要。

需要完整正文时使用：

```text
rovai camp read --camp-id <campId> --mode item --message-id <messageId>
```

正文超过单次返回时按 `nextBodyOffset` 继续读取。只接受同时满足以下条件的开场观点：

- 可信发送者在冻结的预期参与者集合中；
- `replyToMessageId` 等于清单中分配给该成员的 invitation `messageId`；
- 正文携带相同 Campfire ID 与该 invitation `messageId`；
- 内容确实回答当前话题。

其它公开意见可以阅读，但不计作正式开场。同一成员重复回复时只采用第一份完整有效开场，后续内容仅作补充。

对已经有效回复的成员只记录一句核心判断、重要条件和置信度；此时可以整理材料，但还不能合并共识、判断“没有分歧”或选择分岔点。

每次 continuation 都计算 Opening Barrier：

```text
expected participants
= valid direct opening replies ∪ authoritatively unavailable or user-skipped participants
```

只有 Core/Runtime 明确报告该邀请收件人的终态失败、可信 Collaboration State 明确显示成员已退出/被移除、该成员直接拒绝，或用户明确要求跳过，才算 authoritative unavailable。`accepted`、queued、busy、`away`、暂时未回复和本地经过的时间都不是不可用终态，也不创建本地 timer。

Barrier 未满足时，不得选择分岔点或发布纪要。可以通过 public-only `rovai send` 发布一条 `### 篝火讨论 · 等待开场`，列出 Campfire ID、已有效回复、权威不可用与仍等待成员，然后结束当前 Run；不要使用 `--to-user`。

等待状态中每个 unavailable/skip 条目都记录可信证据，例如用户指令 message ID、成员直接拒绝 message ID，或 Runtime terminal code。后续 continuation 只从当前可信证据，或由同一 Default Lead 发布且带相同 Campfire ID 的既有等待状态，继承这些有证据的终态；不能从一条没有 evidence 的旧摘要扩大 unavailable 集合。

Barrier 满足后，若仍有至少两位有效参与成员才继续。已选择三位成员而其中一位有权威终态时，可以由剩余两位继续；不足两位时说明降级或终止。

只有 Barrier 已满足，才合并真正重复的共识、保留条件性支持与明确反对，并标记最可能改变结论的分岔点。没有实质分岔时直接准备纪要。

## 安排定向回应

整场主动安排 0–2 次定向回应，一次只邀请一位成员。通过 `rovai send --to <被点名成员 Agent ID>` 发送；消息会自动回复当前触发消息。若要回应的观点不是当前触发消息，必须在正文中准确引用或概括，不得假装选择了另一个 reply target。

```markdown
### 篝火讨论 · 定向回应

**Campfire ID**

`<本场唯一 ID>`

**话题**

> <当前话题>

**回应的分岔点**

<明确问题；只引用与分歧直接相关的一小段>

请说明你是维持、修正原判断，还是只在某些条件下支持。
请直接回复这条请求，不需要重复完整开场观点。
```

只接受可信发送者是被点名成员、且当前消息直接回复该请求的真实结果，再决定是否需要第二次。

## 主动短澄清

Campfire 主动发起的短澄清全场最多一次。多处含糊时，只选最可能改变共识、分歧或最终建议的一处。

```markdown
### 篝火讨论 · 澄清

**Campfire ID**

`<本场唯一 ID>`

**话题**

> <当前话题>

我准备把你的最终立场写成：

> <一句话>

准确吗？不准确时请直接回复这条请求，给出一条最小修改。
```

其他不确定内容直接写入纪要，不继续增加往返。

通过 `rovai send --to <被询问成员 Agent ID>` 发出澄清；只接受该成员对当前澄清请求的直接回复。不要使用 `--to-user`。

## 最终发布

读取 [篝火纪要](notes.md)，在纪要正文保留相同 Campfire ID，通过 `rovai send --body <纪要正文>` 发布唯一 public-only 纪要，不带 `--to` 或 `--to-user`。Core 会让纪要回复当前 AgentRun 的触发消息；不要声称可以改选最初用户话题或邀请根消息，也不要再次唤醒参与者。

发布后把讨论视为结束。迟到回复可以作为补充信息阅读，但不自动更新纪要或重新主持；只有用户明确要求时才继续。

不要因发布纪要自动创建 Task、写入 Memory 或 ADR，也不要直接开始实施。
