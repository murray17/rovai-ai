---
document_type: model-context-change
version: v1.72
change_id: independent-chat
revision: 5
confirmation_status: pending
authority: proposed-model-input-change-statement
implementation_baseline: 3000b971f22bae67f45ded8e2d051bc85cc61803
last_updated: 2026-11-25
---

# 独立聊天的模型输入 R5

本稿规定队员实际读到的文字。聊天页面、侧栏、已读位置、排队展示和公开操作的回执归[聊天后端提案](chat-backend-proposal.md)。

## 变更前

基线里的独立聊天尚无模型输入。会话内单聊使用 [Single Chat Charter](../../../crates/rovai-core/resources/charter-rovai-single-chat.md) 和[每轮四句 Guidance](../../../crates/rovai-core/resources/single-chat-guidance-v3.json)。其 `RUN_FACTS` 至少含 Thread 附件输出根，有未结算外部操作时另含 `externalEffect`。`WORKSPACE` 来自关联使命。公开插话通过 `context_manifest.source_delivery_id` 关联 Delivery。当前版本配对见 [ContextManifest v45](../../contracts/context-manifest-evidence-v45.md)。

## 变更后

### 新建原生会话

「帮我润色这条发版通知」只需在聊天里给出文案。「把这条通知发到发布组」才请队员发布。即使队员已是发布组成员，两种请求也要产生不同的结果。因此 Charter 保留一句关于创建或写入 Thread 的指引。它涵盖发消息、建改任务和修改使命。为回答问题而读取 Thread 沿用读取权限，明确交办的写操作沿用 §5 的目标与成员校验。[工具授权](chat-backend-proposal.md#5-31-项-agent-cli-与授权)

下面是**首次开聊的完整 Bootstrap 示例**。假设用户选择了只填姓名的阿澈，且已开启 Rovai Memory。`/example/rovai/skills` 是示例路径，实际值取自执行 Host。两个技能的说明取自基线中的受管文件。

```text
[SESSION_CHARTER]
Reply in this private chat. Create or write to a Thread only when the user asks.
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

每个话题绑定自己的原生会话。`MEMBER_IDENTITY` 属于系统提示，六个字段取自所选队员的 `agent_profile`。填写了职责、工作原则等资料时，这里就带上原值。换成洛可时，聊天规则相同，身份换成洛可的档案。首发、续聊和插话的 `CURRENT_INPUT` 都只装当次用户输入。[身份读取与区段顺序](../../../crates/rovai-core/src/context.rs)

`ROVAI_PLATFORM_SKILLS` 是按需读取工具指南的索引。`cli-operations` 常驻，关闭记忆后索引里只有这一项。独立聊天没有所属团队 Thread，因此省去该 Thread 的 `TEAM_GUIDANCE`，也省去按 Camp 成员构建的 `MEMORY_ENTRYPOINT`。个人记忆仍按开关和实际队员权限访问。队员额外配置的工具箱技能随 Run 提供，见下节。[Bootstrap v6](../../contracts/native-session-bootstrap-v6.md) · [平台技能选择](../../../crates/rovai-core/src/context/claim.rs) · [技能索引格式](../../contracts/skills-rebuild-v1.md)

运行端的实际通道须核对。已有原生指令入口的适配器使用该入口。`first_payload` 会将启动规则拼入首条用户输入，例如 Hermes 目前明确使用 user 层。这条既有路径本身不能证明队员身份已进入系统提示。此类适配器的原生身份通道需要单独验证，聊天消息不承担身份投递或补发。[Core 投递模式](../../../crates/rovai-core/src/context.rs) · [Hermes 的现行投递](../../contracts/hermes-managed-runtime-v1.md#session-与输入)

### 每条输入

本轮只有一条普通提问，没有附加技能或结果未知的操作时，动态正文如下。

```text
[CURRENT_INPUT]
{"message":"环比是什么意思？"}
[/CURRENT_INPUT]
```

直发、FIFO 正式发表和插话共用一种 `CURRENT_INPUT`。字段如下，空数组省略。正文保留用户原文，只有附件或引用时允许空字符串。

```ts
type ChatCurrentInput = {
  message: string
  quotes?: Array<{ kind: 'message_excerpt', text: string }>
  attachments?: string[]
  skills?: Array<{ name: string, path: string }>
}
```

引用使用已有的摘录投影，附件取已核验的源路径，技能链接只含用户在这条输入中选用且可读取的项。直发、FIFO 和插话的作者都是用户，模型侧省去恒定的 `source.type` 和 `mentionsCurrentUser`。Core 仍冻结真实来源、Run、代次、话题和输入序号。[引用投影](../../../crates/rovai-core/src/message_quote.rs) · [Skill 链接](../../contracts/skills-rebuild-v1.md)

区段顺序为 `RUN_FACTS?`、`ROVAI_ADDITIONAL_SKILLS?`、`CURRENT_INPUT`。只有两个条件会增加上下文。

| 条件 | 队员收到的内容 |
| --- | --- |
| 同一话题的原操作仍有 `action_execution.status='unknown'` | 沿用原判断，仅加上 `[RUN_FACTS]`、一行 `{"externalEffect":{"state":"unsettled","requiredAction":"reconcile_before_repeat"}}` 和 `[/RUN_FACTS]`。核对与停止重发仍执行原有回执规则。无此事实时，整个区段省略。 |
| 新 Run 的队员工具箱配置与本次显式选择的并集有可用项 | 用现有 `ROVAI_ADDITIONAL_SKILLS` 格式列出这些技能，范围只到本 Run。空集合省略。插话属于原 Run，沿用其工具箱，当次另选的技能只进本条 `CURRENT_INPUT.skills`。 |

Host 将本话题自有目录设为 Runtime 的实际工作目录，续聊和插话使用同一目录。文件工具与答复预览以它为相对路径基准，因此动态输入省去 `attachmentOutputRoot`。如果运行端无法使用该目录，按现有准备失败处理。独立聊天没有关联使命，省去 `WORKSPACE` 和 Git 分支查询。即使用户给出目标 Thread，也只给该次工具操作定位，聊天运行目录保持原值。[现有 Workspace 选择与动态区段](../../../crates/rovai-core/src/context.rs) · [聊天文件预览](chat-backend-proposal.md#4-历史导航归档与删除)

## 明确不变

31 项 CLI 使用现有 Router 和工具帮助。Core 按操作校验当前 Run、显式目标和各项权限。向已有 Thread 写入时，还在事务内复核实际队员的有效成员身份。队员的最终正文直接回到当前聊天。`rovai chat history` 只能读取本话题在本轮触发消息之前的历史，同一队员的其他聊天也不可见。公开历史与任务按需通过各自的工具读取。原有公开 Thread 和会话内单聊维持各自的输入格式、权限、预算和绑定。

## 版本、迁移与恢复

新聊天拟用 Formatter/Manifest 46、Facts 15、Delivery Profile 17。Facts 13、14 的公开或旧单聊形状均保留。Bootstrap 沿用 formatter 6，冻结固定 Charter 的正文摘要。身份及其恢复复用队员系统提示的既有记录。无未决操作时，新输入的 `runFactRefs` 为空。有未决操作时只记录现有的 `external_effect` 引用。预算按实际交付字节计算。

直接输入、FIFO 读取本轮触发的 `conversation_message`。插话读取冻结的 `single_chat_pending_input`。在原 Manifest 上增加可空的 `source_chat_input_id`，与 `source_delivery_id` 互斥，两者都为空表示初始输入。每条私有插话至多有一份 Manifest。运行端校验同一 Run、代次、原生绑定和输入序号。重启从冻结的输入与接收凭据继续。已接收或送达未知的插话沿用原凭据核对，同一输入至多发表一次。旧 Manifest 和原始 Blob 按冻结的原版本恢复。[插话及接收规则](../../contracts/message-delivery-v20.md)

## 验证

1. 用同一句话分别直发、排队和插话，核对三者的 `CURRENT_INPUT`。仅含附件或引用时核对可选字段。同一名发布组成员收到「帮我润色通知」时只给出私聊答复，收到「把通知发到发布组」时才向该组写入消息。引用里的指令本身不会触发公开写入。
2. 分别选阿澈、洛可，以相同提问开聊。核对两个系统提示各自的队员资料，两个 Charter 和 `CURRENT_INPUT` 则逐字相同。检查运行端实际收到的 system 和 user 内容，身份资料只出现在系统指令侧。再为阿澈开两个话题，在 A 写入相对路径的文件，预览定位到 A。模拟 A 中一个结果未知的操作，只有 A 获得核对提示，B 的上下文和历史均不含 A 的数据。
3. 按示例配置首次开聊，核对 Bootstrap 的区段顺序、身份六字段和平台技能索引。关闭记忆后另开话题，核对索引只含 `cli-operations`。给队员配置一个工具箱技能，开新轮、插话并重启，核对动态索引及显式引用，只恢复一次已接收输入。对照旧 Thread 和会话内单聊的冻结样本。

## 二次确认

R5 待用户确认。此状态只适用于本稿涉及的模型输入和恢复合同。
