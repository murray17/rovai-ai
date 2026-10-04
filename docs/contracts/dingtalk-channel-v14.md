---
document_type: protocol-contract
contract: dingtalk-channel-v14
authority: dingtalk-outbound-retry-and-attachment-delivery
status: accepted
version: 14
source_version: v1.72
last_updated: 2026-09-28
---

# DingTalk Channel v14

继承 [v13](dingtalk-channel-v13.md) 的登录、身份、发布、入站附件与渠道管理合同。本版仅替换出站附件 Gate 和钉钉 Host 的外部投递错误分类；Core 的 Outbox、lease、顺序和失败提示语义继续由 [Channel Message Bridge v1](channel-message-bridge-v1.md) 拥有。

当前执行卡撤回时机同样以 [Channel Message Bridge v1](channel-message-bridge-v1.md#execution-card-recall) 为准，
覆盖继承版本的根请求入场规则。按同一渠道会话和队员等待后继 Run 真正开始；旧 Run 仍在执行时保留停止入口，
终态封存后再用持久 carrier identity 调用 Robot recall。排队卡仍在对应 Request 入场后撤回。

## 原生出站附件

Agent 消息显式携带的 `agent_attachment` 沿用 Core 已有的独立 Outbox delivery。Host 以 `camp.attachments.desktopOpenTarget` 读取属于消息的文件目标；Source Ref 使用 `owner=message`、精确 `campId/messageId/attachmentRefId`。managed attachment 在发送前核对字节数与 SHA-256。缺失、越权、摘要不符时不访问钉钉，由 delivery 失败和既有附件提示路径收口。正文和各附件仍由 Core 维持各自 delivery、顺序和失败结算，不重跑 Agent。

图片和普通文件均使用 App access token 调用[钉钉媒体上传接口](https://open.dingtalk.com/document/orgapp/upload-media-files) `oapi.dingtalk.com/media/upload`：query 携带 `access_token` 和 `type=image|file`，multipart 仅提交 `media`，取得 `media_id`。发送时保留平台所需的 `@` 前缀。图片随后以 `sampleImageMsg` 和 `photoURL=mediaId` 发给当前 Bot 的群或私聊目标；普通文件按[机器人消息格式](https://open.dingtalk.com/document/orgapp/types-of-messages-sent-by-robots)以 `sampleFile` 的 `mediaId/fileName/fileType` 投递。图片只接受与文件名相符的 JPEG、PNG、GIF、BMP；普通文件只接受平台文件消息列出的 `xlsx`、`pdf`、`zip`、`rar`、`doc`、`docx`。Host 在读取文件前拒绝超过 20 MiB 的文件，上传适配器也在发请求前校验实际字节数；超出大小以 `dingtalk_attachment_size_unsupported`、格式不符以 `dingtalk_attachment_type_unsupported` 结算，均走既有失败提示。文件名只取 basename。群消息使用 `groupMessages/send`，私聊使用 `oToMessages/batchSend`，仅使用接收 Bot 的 `robotCode` 和冻结的渠道目标；不借用 custom webhook 或 Source Ref 的本地路径。

Host 只把平台返回的 `processQueryKey` 作为成功的 `externalDeliveryMessageId`。上传成功但消息发送失败时，delivery 仍失败；重试可重复上传同一文件，不重新生成 Agent 正文或 Camp 附件。真实租户的媒体上传权限、文件格式和桌面/手机收件呈现尚需单独验收，自动 fixture 不等于平台验收。

## 失败分类与重试

钉钉 HTTP 429、5xx、平台结构化限流码 `90002`、旧版 OpenAPI 的超时码 `15`/无子码的 `88`、连接或超时异常，以及 Bot 暂时没有托管连接，标记 `retryable=true`，交由 Core 既有有界 Outbox 重试。[钉钉超时重试建议](https://opensource.dingtalk.com/developerpedia/docs/develop/best-practices/retry/)列出了旧版超时码。其余 HTTP 4xx、业务拒绝、资源缺失、内容完整性失败和不支持格式为终态失败。分类使用结构化 HTTP 状态、平台错误码或本地错误类型，不解析错误文案；failureCode 不包含令牌、远端响应正文或文件内容。

Robot 消息发送接口没有供本合同使用的客户端幂等键。请求已经抵达平台但响应在网络中丢失时，有限次自动重试可能造成重复消息；Host 不伪造成功身份，也不通过重跑 Agent 补发。此情形的精确去重需要平台可验证的发送幂等/查询能力，真实租户验收应单列。上传阶段的重试只会增加媒体对象，不会自行产生重复聊天消息。
