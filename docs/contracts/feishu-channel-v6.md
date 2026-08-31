---
document_type: protocol-contract
contract: feishu-channel-v6
authority: feishu-channel-project-binding-admission-delivery
status: accepted
version: 6
last_updated: 2026-08-30
---

# Feishu Channel v6 Contract

本合同继承 [Feishu Channel v5](feishu-channel-v5.md) 的账号、发布、Owner、项目、admission、roster、Outbox、
不可变 sealed snapshot、终态双层折叠和全部执行卡内容预算。本次替换 v5 的分页成功应答与相关预览语义：
新页由同步 callback response 提交，不再先 PATCH 原消息再返回空 ACK；永久公开正文另按下文改为接收人卡片。秘密存储仍由
[Channel Storage v2](channel-storage-v2.md) 拥有，不增加数据库 Migration、持久视图状态或应用资料更新。

终态显示文案进一步明确为“用时 …”、原生分隔线、“执行过程 · N 条指令”，具体呈现见
[渠道 UI](../ui/components/channel-settings.md#飞书执行卡)。这是单位和层级的呈现澄清，不改变 v5 的真实时长、
整轮 command 计数或空记录语义；分隔线同样计入既有 element/byte 预算。

## 1. 单一分页提交

正式卡继续以 callback envelope 的 Owner、冻结 App、authoritative external message、`terminal_sealed` 和
exact snapshot sequence 经 Core 授权，再读取 sealed source、校验实际页码范围并渲染目标页。
成功只返回以下同步应答，由飞书应用于本次点击的原卡：

```json
{
  "card": {
    "type": "raw",
    "data": { "schema": "2.0", "body": { "elements": [] } }
  }
}
```

示例中的 `data` 由完整目标页替换，包含 v5 要求的 header、预算、总面板及页码按钮。任何合法翻页，包括返回
第 1 页，总面板均 `expanded=true`，单条 command 均 `expanded=false`。成功不附 Toast。

一次分页只有此 response-card 更新，不在 ACK 前后额外调用 PATCH/`updateCard`，不排异步补偿或迟到更新。
这避免独立消息更新与本次点击的空应答竞争、把已显示的新页退回点击前的页面。空 ACK 只适用于不更新卡片的
应答，不再表示分页成功。不写 Core page/view state、不增加 nonce、不排 Outbox、不产生 upsert 或触发 pump。

SDK 继续将 response card 编码到 WebSocket callback ACK；按 envelope event ID 去重同一次点击的重投，
不同 event 的“下一页／上一页／再下一页”独立处理。没有 event ID 时沿用 v5 的保守去重边界。
执行中、terminal seal 与正常投递恢复仍可使用 `updateCard`，且继续检查飞书业务码；它们不是分页 callback。

## 2. 截止时间与失败

Main 从进入分页处理器起保留最多 2.5 秒，为飞书 3 秒响应窗口留余量。授权、读取或渲染已超过截止时间时，
仅返回固定安全错误 Toast，不包含 card；迟到完成不能追加更新，也不自动重试。
Owner、App、消息、sequence、sealed 状态或页面范围不匹配时继续 fail closed。

- 回调可响应但 Core 不可用：提示检查本机 Rovai 状态；
- 授权、读取或渲染超时：提示翻页响应超时、稍后重试；
- 其他本地应答准备失败：提示执行记录暂时无法翻页；
- App、设备或 WebSocket 离线，或飞书拒绝应答卡片：由飞书处理连接、超时或卡片错误。

诊断只记录允许的 reason 和非敏感结构化字段，不输出原始错误、provider message 或凭据。
准备好 response card 不代表飞书已显示新页，不能将该本地日志作为远端验收证据。离线时不承诺 Rovai 自定义
Toast，不引入云端服务。两层原生展开/收起继续在客户端本地完成，只有跨页要求在线 callback。

## 3. 预览与恢复

显式预览与正式卡共享渲染器、预算、展开选项、response-card 提交和错误响应。预览仍使用当前 Bot 连接，
只向已冻结 Owner 发送；每次翻页重新验证当前 Owner、App、原消息、sequence 和缓存有效期。
页面以不可变集合保存在 Main 内存，每次应答复制目标页，不保存当前页。预览不读写假的 Core Run 或日用 SQLite，
不启动竞争 WebSocket；重启或过期后的旧预览不能冒充可恢复的正式卡。

正式卡仍从持久 sealed snapshot 读取；不批量回填旧卡。合法翻页使用 v6 应答，保持原 App ID、message ID、
snapshot sequence 与封存内容；下一轮根 CampTurn 的 recall 语义不变。已发布飞书应用资料不更新。

## 4. 永久公开正文与接收对象

`agent_output` 由实际作者的冻结 Bot 新建无标题 Card 2.0，不再发送普通 Markdown/post 消息，不更新执行卡、queue ack
或更早正文。有真实回复关系时，顶部先显示辅助字号的静态引用，再显示 Markdown 正文；存在真实 A2A 接收对象或结构化 CurrentUserMention 时，在正文下方用辅助字号显示
`发送给 @队员 @Owner`。多个原生 mention 仅以空格分隔，不添加逗号、顿号、角色标题、状态或 callback。

Core 生成 Main-only `presentationVersion=1` payload：

- `body`：从源 Structured Content 生成的飞书专用正文，不包含结构化 CurrentUserMention；普通 Text 中的字面 `@你`
  保留，不进行字符串替换。源 CampMessage、digest、Renderer 正文、Agent Context 和通知事实均不改写；
- `memberRecipients`：只从该消息的 `public_a2a` MessageDelivery 读取，按 `recipientCanonicalPosition` 排序，包含
  `agentId/displayName/openId`。不从正文、mention 名字、初始 Run targets 或当前 roster 猜测 A2A 接收对象；
  `gather_completion` 不作为公共收件人，已 settled 的公共 A2A 仍保留其接收事实；
- `mentionPrincipal`：继续只从 Structured Content 派生。Owner 的原生 ID 使用 claim 已有的、原 ExternalPrincipal
  在发送 App 下的 `recipientOpenId`，不借用其他 App 的 Owner Open ID。私聊同样可以显示该接收对象行；
- `reply`：只沿源消息的 `reply_to_camp_message_id` 读取同 Camp 中更早且未 tombstone 的直接父消息，不使用外部
  `root_id/parent_id`、Topic root 或本轮初始消息推断。没有关系为 `null`；可读时包含
  `status=available/messageId/authorDisplayName/body`，不可读时仅 `status=unavailable`，不泄露跨 Camp 内容。

回复预览显示“回复 作者”及原消息摘要。Agent 名称来自 Profile；ExternalPrincipal 仅在与发送 Bot 所属账号的 canonical
Owner 匹配时使用该账号名称，否则保留自身显示名；本地 user 显示 Owner。摘要由父消息 Structured Content 派生，不读
Human body cache，移除 CurrentUserMention 与嵌套 ExternalQuote，不递归引用。最多 3 行、240 个 Unicode scalar values，
超出以 `…` 结尾且计入预算。Main 将作者和摘要转义为静态 Markdown 引用，不产生原生 @、链接或 callback；空正文显示
“（无文本）”，不可用显示“回复的消息已不可用”，没有关系则省略引用。此投影不更改源回复关系或模型上下文。

Bot 原生 ID 只能来自与作者同账号的已发布 Bot identity；不存在有效映射时显示转义后的静态名称，不猜 ID、不替换成其他
Bot。Owner 映射缺失时只显示静态 `@Owner`。原始公开正文里的 `<at>` 标签转义为文字，只有 Core 接收对象投影可以生成
原生提及。飞书 mention 只承担展示/通知；A2A dispatch 仍完全在 Core 内，不通过 Bot 互相 @ 发起新的 Run。

永久正文不套用执行卡的 10/20 行截断。超过整卡 24,000 UTF-8 JSON bytes 时按完整内容顺序拆成连续卡片，保留 Unicode
与代码围栏；仅第一张含回复引用，只有最后一张含接收对象行，两者均计入 byte 预算。每个分片都发到原 p2p/group/topic，Topic 的每个分片均 reply 原 root，不能退回群根。
Main 复用原 Bot 的 SDK client 发送 `interactive`，使用由 delivery ID 和分片序号确定的 UUID；丢失响应/部分发送重试复用 UUID，
利用飞书一小时去重窗口，不承诺跨该窗口 exactly-once。正常 Outbox lease、attempt、退避与永久输出 settlement 不变；正文全部
分片发送成功后才 settle，附件仍等待正文终态并独立投递。

未发送的旧 `agent_output` 在 claim 内由源 Structured Content/MessageDelivery/直接回复关系升级并冻结同一 payload、delivery ID 与 dedupe key；
已有 v1 payload 的重试不重新推导内容，缺失 `reply` 字段的已冻结 v1 按无引用渲染；已发送历史消息不批量回填。
不增加 Migration 或持久视图状态，钉钉输出不改变。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [飞书官方卡片回调处理](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/handle-card-callbacks)
- [飞书官方卡片回传交互](https://open.feishu.cn/document/feishu-cards/card-callback-communication)
- [飞书 Card 2.0 Markdown 与原生 mention](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/content-components/rich-text)
- [飞书消息创建、大小限制与 UUID 去重](https://open.feishu.cn/document/server-docs/im-v1/message/create)
- [v1.34 实施计划](../versions/v1.34/implementation-plan.md)
