---
document_type: protocol-contract
contract: feishu-chat-bot-v1
authority: feishu-chat-bot-mode-admission-chat-items-outbound
status: historical
version: 1
source_version: v1.72
last_updated: 2026-10-20
---

# 飞书聊天 Bot v1 合同

本合同拥有聊天 Bot 的模式开关、聊天准入、独立聊天记录、沟通事项、出站消息和模型动作的字段与状态语义。工作 Bot 的
[Feishu Channel v1](feishu-channel-v1.md) 准入、Camp 绑定、Delivery 与 AgentRun 链路不在本合同内，也不因本合同改变。

## 1. 模式与 Owner

| 事实 | 语义 |
| --- | --- |
| channel_chat_bot.owner_only = 1（缺行同义） | 工作 Bot。非 Owner 消息仍由工作链路拒绝；聊天模块不参与 |
| channel_chat_bot.owner_only = 0 | 聊天 Bot。Owner、同事、已建联外部联系人都进入聊天路径，均不创建 AgentRun |

- 一个 (provider, app_id) 只有一种模式；provider 只接受 feishu、lark。
- 关闭开关前必须已保存模型 provider、model 与模型凭据；否则 Core 拒绝 channels.chat.configure。
- Owner 仍由已发布 Bot 的 Owner 身份判定；聊天模式不重新认领 Owner，也不把同事合并成 Owner。
- 切回工作 Bot：pending 出站消息改为 failed（不补发），waiting 事项改为 paused，非 Owner 消息不再受理。
- 切回聊天 Bot：paused 事项恢复为 waiting；已取消的出站消息不恢复。

## 2. 准入

- 私聊全部进入聊天路径；群聊和话题群只处理显式 @ 该 Bot 的消息。
- 入站去重键为 provider + app_id + external_message_id，重复事件不追加会话轮次、不触发出站。
- 聊天路径不读取、不复用该 Bot 的 Camp、Delivery、ChannelTurnRequest 或工作会话。
- 回复位置在受理时冻结为该入站消息的 chat_id；模型动作不能改投其他会话。
- 群内询问他人时，提示对方“回复这条消息并 @ 我”。

## 3. 存储

| 表 | 内容 |
| --- | --- |
| channel_chat_bot | provider、app_id、owner_only、模型字段、资料目录与状态、updated_at |
| channel_chat_credential | 模型密钥；只由 Core 读取，从不进入 Renderer 快照 |
| channel_chat_message | 入站消息事实与去重键 |
| channel_chat_turn | 独立聊天轮次；materials_only = 1 的资料片段不进入下一轮上下文 |
| channel_chat_item | 请求者、回复目的地、被询问人、问题、询问消息 ID、汇报水位、状态 |
| channel_chat_outbound | 收件人、正文、来源、幂等键、lease、结果、外部消息 ID |

- 事项状态闭集：waiting、reported、closed、paused。reported 仅作为历史值；阶段汇报后仍保持 waiting，以便接收补充。
- 出站状态闭集：pending、sent、failed、unknown。unknown 表示无法确认是否发出，禁止盲目重发。
- 迁移 205 只新增上述表；不改变 rovai_data_contract.projection_schema_version。

## 4. 方法与视图

| 方法 | 参数 | 结果 |
| --- | --- | --- |
| channels.chat.snapshot | provider、appId | 配置视图；缺行返回工作模式默认值 |
| channels.chat.configure | commandId + 配置命令 | 配置视图；切换模式时执行第 1 节副作用 |
| channels.chat.credential.set | commandId + provider、appId、apiKey 或 null | boolean（是否已保存） |
| channels.chat.credential.get | provider、appId | string 或 null；Host 专用 |
| channels.chat.inbound | commandId + 入站事实 | mode、duplicate、owner |
| channels.chat.turn.append | commandId + role、body、materialsOnly | appended |
| channels.chat.context | provider、appId、chatId、limit | 最近轮次（不含资料片段） |
| channels.chat.item.create | commandId + 事项事实 | 事项视图 |
| channels.chat.item.update | commandId + itemId、status、markReported | 事项视图 |
| channels.chat.items.waiting | provider、appId、targetExternalId | 该人等待中的事项 |
| channels.chat.items.active | provider、appId | 全部等待中事项（Owner 结束用） |
| channels.chat.ownerTarget | provider、appId | Owner 的 open_id；不存在时 null |
| channels.chat.outbound.enqueue | commandId + 收件人、正文、来源、幂等键 | outboundId、duplicate |
| channels.chat.outbound.claim | provider、appId、workerId、limit | 已租约的出站消息 |
| channels.chat.outbound.settle | commandId + outboundId、status、外部 ID、失败码 | settled |
| channels.chat.outbound.cancel | provider、appId | cancelled |

- 视图字段使用 camelCase；凭据只以 credentialConfigured 布尔值出现。
- 入站与出站命令以自然键幂等：同一 external_message_id 或同一 idempotency_key 不产生第二条事实。

## 5. 模型动作

模型输出一个 JSON 对象，包含 reply（可为 null）和最多一个动作。动作闭集：

search_materials、find_person、forward、ask、ask_owner、close_item。

- 程序校验发送目标必须来自本次 @ 提及或 find_person 结果；身份、目标或权限无效时停止该动作并回复明确失败，不猜测执行。
- 一轮对话最多 4 个动作循环；工具结果不授予新权限。
- close_item 只接受 Owner。
- 模型调用失败时只发送简短失败提示，不回退到工作 Agent 或工作模型路径。

## 6. 答复关联

1. 引用消息 ID 等于某事项的 ask_message_id：关联该事项。
2. 没有引用，且该人只有一件 waiting 事项：直接关联。
3. 有多件 waiting 事项：请对方引用询问或说明是哪一件，不猜测。
4. 没有等待事项：按普通聊天处理。

- 新请求优先：模型判定新消息是新转发、代问、资料查询或其他请求时，不当作待回复事项的答复。
- 阶段汇报后同一事项的补充只汇报新增或更正部分。
- 事项结束后，迟到的回复不再回传，也不重新打开。

## 7. 资料读取

- 只读 UTF-8 的 .md 与 .txt，包含真实子目录；跳过隐藏文件、符号链接、Windows junction、不支持格式、超过 1 MiB 的文件和无法解码的内容。
- 每个目录最多 1000 个支持的文件；每次请求最多带入 24 KiB 片段。超出时告知资料不完整。
- 每次资料问题都重新扫描目录；新增、修改、删除、解绑立即生效。
- 资料片段在聊天上下文中标记为 materials_only，不进入后续轮次；文档内容不能改变权限或触发动作。
- 输出注明出处（文件名与文中业务日期），没有日期时写“未标注日期”，不使用文件修改时间。

## 8. 出站与异常

| 情况 | 行为 |
| --- | --- |
| 平台返回成功 | sent，记录外部消息 ID |
| 平台明确失败 | failed；向请求者说明失败，不报成功 |
| 超时或无法确认 | unknown；提示“暂时无法确认是否发出，请勿重复发送” |
| 重启 | pending 消息按幂等键继续投递；已 sent/failed/unknown 不重试 |
| 原会话不可达 | 停止投递，不改投；能联系到请求者时告知 |
| 外部联系人未建联 | 不发送，提示先建立单聊 |
| 通讯录权限未生效 | 只暂停按姓名找人；@、Owner 和已对话联系人照常 |

## 9. 对外展示

聊天路径只发送普通文字。不发送运行状态卡、执行过程、控制台入口、附件、目录清单或本地路径。
