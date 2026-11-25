---
document_type: model-context-change
version: v1.72
change_id: independent-chat
revision: 8
confirmation_status: pending
authority: proposed-model-input-change-statement
implementation_baseline: 3000b971f22bae67f45ded8e2d051bc85cc61803
last_updated: 2026-11-25
---

# 独立聊天的模型输入 R8

本稿规定队员实际读到的文字。聊天页面、侧栏、已读位置、排队展示和公开操作的回执归[聊天后端提案](chat-backend-proposal.md)。

## 变更前

基线里的独立聊天尚无模型输入。会话内单聊使用 [Single Chat Charter](../../../crates/rovai-core/resources/charter-rovai-single-chat.md) 和[每轮四句 Guidance](../../../crates/rovai-core/resources/single-chat-guidance-v3.json)。其 `RUN_FACTS` 至少含 Thread 附件输出根，有未结算外部操作时另含 `externalEffect`。`WORKSPACE` 来自关联使命。公开插话通过 `context_manifest.source_delivery_id` 关联 Delivery。当前版本配对见 [ContextManifest v45](../../contracts/context-manifest-evidence-v45.md)。

## 变更后

### 新建原生会话

下面是**首次开聊的完整 Bootstrap 示例**。假设用户选择了只填姓名的阿澈，且已开启 Rovai Memory。`/example/rovai/skills` 是示例路径，实际值取自执行 Host。两个技能的说明取自基线中的受管文件。

```text
[SESSION_CHARTER]
You are in Rovai. Reply in this private chat.
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
{
  "name": "阿澈",
  "teamRole": "",
  "professionalResponsibilities": "",
  "personalityTraits": [],
  "workingPrinciples": "",
  "growthTopic": ""
}
[/MEMBER_IDENTITY]

[ROVAI_PLATFORM_SKILLS]
{"root":"/example/rovai/skills","skills":[{"name":"cli-operations","desc":"Choose among Rovai messages, Missions and history; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly."},{"name":"memory-stewardship","desc":"Maintain durable collaboration preferences, agreements and lessons when the user asks to remember, correct or stop using them, or current evidence warrants capture. Excludes temporary work, project facts, sensitive data and speculation."}]}
[/ROVAI_PLATFORM_SKILLS]
```

每个话题绑定自己的原生会话。`MEMBER_IDENTITY` 的六个字段取自所选队员的 `agent_profile`。同一运行端下，独立聊天与 Thread 使用相同的身份投递通道。例如 Hermes 把上面的三个 Bootstrap 区段放在首条 `user` 消息的 `[Rovai 协作规则]` 块内，随后接下节的动态正文。同一会话后续沿用原规则，只有 Bootstrap 本身变更才随普通输入附上更新块。`CURRENT_INPUT` 始终只含当次用户输入。[Bootstrap 合同](../../contracts/native-session-bootstrap-v6.md) · [Hermes 的首次与后续输入](../../contracts/hermes-managed-runtime-v1.md#session-与输入)

`ROVAI_PLATFORM_SKILLS` 是按需读取工具指南的索引。`cli-operations` 常驻，关闭记忆后索引里只有这一项。独立聊天没有所属团队 Thread，因此省去该 Thread 的 `TEAM_GUIDANCE`，也省去按 Camp 成员构建的 `MEMORY_ENTRYPOINT`。个人记忆仍按开关和实际队员权限访问。工具箱技能随每条输入投递。[平台技能选择](../../../crates/rovai-core/src/context/claim.rs) · [技能合同](../../contracts/skills-rebuild-v2.md)

### 每条输入

直发、FIFO 出队和插话按相同顺序生成动态正文，即可选的 `RUN_FACTS`、必有的 `ROVAI_ADDITIONAL_SKILLS` 和 `CURRENT_INPUT`。例如阿澈已关闭全部工具箱技能，用户直接提问，没有选用技能，也没有结果未知的操作。

```text
[ROVAI_ADDITIONAL_SKILLS]
Current for this run; replaces any earlier Rovai Additional Skills.
{"root":"/example/rovai/skills","skills":[]}
[/ROVAI_ADDITIONAL_SKILLS]

[CURRENT_INPUT]
{"message":"环比是什么意思？"}
[/CURRENT_INPUT]
```

每条输入准备时，沿用 Thread 的构建器，把队员当时配置的工具箱技能与**本条消息**显式选用的工具箱技能合并。索引列出全部可用项，按名称去重、排序。即使集合为空，也发送上例的完整区段。本条消息显式选用的可读技能另在 `CURRENT_INPUT.skills` 给出文件链接，原生技能只进这组链接。本条选用不会改写队员配置。[工具箱和消息链接格式](../../contracts/skills-rebuild-v1.md) · [Thread 插话规则](../../contracts/context-delivery-profile-v14.md) · [Thread 插话的输入来源](../../../crates/rovai-core/src/context/input.rs)

例如阿澈配置了 `member-studio`，用户在当前轮插话时点选 `review-duo`。本条输入的索引含两项，消息只链接用户点选的一项。

```text
[ROVAI_ADDITIONAL_SKILLS]
Current for this run; replaces any earlier Rovai Additional Skills.
{"root":"/example/rovai/skills","skills":[{"name":"member-studio","desc":"Use to create a Rovai member or revise and confirm the unsaved identity card and avatar for that creation. Exclude profile questions, edits to existing members, and character or avatar designs without roster creation."},{"name":"review-duo","desc":"Review a defined code change with two Thread members independently checking standards, quality and requirements. Applies to the initiator and invited reviewer through the final report; excludes solo review, undefined scope and implementation-only requests."}]}
[/ROVAI_ADDITIONAL_SKILLS]

[CURRENT_INPUT]
{"message":"用 /review-duo 评审这次改动。","skills":[{"name":"review-duo","path":"/example/rovai/skills/review-duo/SKILL.md"}]}
[/CURRENT_INPUT]
```

`CURRENT_INPUT` 的可选字段只在有内容时出现。正文保留用户原文，只有附件或引用时允许空字符串。

```ts
type ChatCurrentInput = {
  message: string
  quotes?: Array<{ kind: 'message_excerpt', text: string }>
  attachments?: string[]
  skills?: Array<{ name: string, path: string }>
}
```

引用使用已有的摘录投影，附件取已核验的源路径。直发、FIFO 和插话的作者都是用户，模型侧省去恒定的 `source.type` 和 `mentionsCurrentUser`。Core 仍冻结真实来源、Run、代次、话题和输入序号。[引用投影](../../../crates/rovai-core/src/message_quote.rs)

只有同一话题的原操作仍有 `action_execution.status='unknown'` 时，才在技能段前加上 `[RUN_FACTS]`、一行 `{"externalEffect":{"state":"unsettled","requiredAction":"reconcile_before_repeat"}}` 和 `[/RUN_FACTS]`。核对与停止重发沿用原有回执规则。

Host 将本话题自有目录设为 Runtime 的实际工作目录，续聊和插话使用同一目录。文件工具与答复预览以它为相对路径基准，因此动态输入省去 `attachmentOutputRoot`。如果运行端无法使用该目录，按现有准备失败处理。独立聊天没有关联使命，省去 `WORKSPACE` 和 Git 分支查询。即使用户给出目标 Thread，也只给该次工具操作定位，聊天运行目录保持原值。[现有 Workspace 选择与动态区段](../../../crates/rovai-core/src/context.rs) · [聊天文件预览](chat-backend-proposal.md#4-历史导航归档与删除)

## 明确不变

31 项 CLI 使用现有 Router 和工具帮助。Core 按操作校验当前 Run、显式目标和各项权限。向已有 Thread 写入时，还在事务内复核实际队员的有效成员身份。队员的最终正文直接回到当前聊天。`rovai chat history` 只能读取本话题在本轮触发消息之前的历史，同一队员的其他聊天也不可见。公开历史与任务按需通过各自的工具读取。原有公开 Thread 和会话内单聊维持各自的输入格式、权限、预算和绑定。

## 版本、迁移与恢复

新聊天拟用 Formatter/Manifest 46、Facts 15、Delivery Profile 17。Facts 13、14 的公开或旧单聊形状均保留。Bootstrap 沿用 formatter 6，冻结固定 Charter 的正文摘要。身份随该运行端的 Bootstrap 恢复。工具箱配置和本条选用项只影响新准备的动态输入，无需清理历史或更新 Bootstrap。恢复已准备的输入时读取原 Manifest 的冻结正文。无未决操作时，新输入的 `runFactRefs` 为空。有未决操作时只记录现有的 `external_effect` 引用。预算按实际交付字节计算。[输入快照存储](../../contracts/input-snapshot-storage-v1.md)

直接输入、FIFO 读取本轮触发的 `conversation_message`。插话读取冻结的 `single_chat_pending_input`。在原 Manifest 上增加可空的 `source_chat_input_id`，与 `source_delivery_id` 互斥，两者都为空表示初始输入。每条私有插话至多有一份 Manifest。运行端校验同一 Run、代次、原生绑定和输入序号。重启从冻结的输入与接收凭据继续。已接收或送达未知的插话沿用原凭据核对，同一输入至多发表一次。旧 Manifest 和原始 Blob 按冻结的原版本恢复。[插话及接收规则](../../contracts/message-delivery-v20.md)

## 验证

1. **身份投递。** 同一运行端、同一队员分别开启 Thread 和独立聊天，核对六个身份字段及实际投递通道。Cline 两边都走原生规则通道。Hermes 两边都在首条 `user` 输入中先放一次完整 Bootstrap，再放动态正文。启动规则未变时，Hermes 的后续普通输入只送动态正文。聊天的 `CURRENT_INPUT` 始终只含本条用户输入。换洛可后核对其身份和相同的聊天 Charter。按首发示例核对三个区段顺序，关闭记忆后另开话题，平台索引只含 `cli-operations`。
2. **同轮插话和下一轮排队。** 阿澈只配置 `member-studio`。直发未点选技能，索引只有该项。忙时先排队 Q（选 `campfire`），再插话 S（选 `review-duo`）。S 须得到上例的两项索引和一个消息链接。S 已签收后关闭 `member-studio` 并重启，恢复时核对 S 的原始字节和回执，S 不再投递。Q 出队时索引和消息链接都只有 `campfire`。原会话历史、Bootstrap 及首轮已冻结的输入均保留。
3. **空索引与消息内容。** 关闭全部工具箱技能，不选技能，分别直发、FIFO 出队和插话。三次都收到完整的空索引，消息均无 `skills` 字段。只点选可读的原生技能时索引仍空，消息多一个指向原文件的链接。纯附件或纯引用输入分别核对对应的可选字段。
4. **话题和公开操作。** 为阿澈开 A、B 两个话题。在 A 写入相对路径的文件，预览定位到 A。A 中结果未知的操作只给 A 增加核对提示，B 的上下文和历史均不含 A 的数据。发布组成员收到「帮我润色通知」时在私聊答复，收到「把通知发到发布组」时才向该组写入。引用里的指令本身不会触发公开写入。对照旧 Thread 和会话内单聊的冻结样本。

## 二次确认

R8 待用户确认。此状态只适用于本稿涉及的模型输入和恢复合同。
