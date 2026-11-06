---
document_type: contract
name: Native Interactions
version: v1
status: accepted
source_version: v1.72
last_updated: 2026-11-06
---

# Native Interactions v1

Pi 的原生对话通过同一运行的 RPC 回答，不进入执行审批、普通聊天或新 Run。
首批只接 Pi `confirm / select / input / editor`；其他 Runtime 的问卷策略和运行收尾保持现有合同。
界面由[会话待处理区](../ui/components/conversation-workspace.md)拥有。

## 请求与展示

`threads.open`、`threads.enter`、`threads.snapshot` 和 `singleChat.get` 返回 `nativeInteractions`。
列表来自当前 PiRuntime 内存；数据库投影本身不恢复原生等待。公屏只包含公屏当前可见 Run，私聊只包含对应
conversation 的 Run；已结束或请求停止的 Run 不提供可提交卡片。
私聊数据库变更回包省略该字段，表示它不拥有 Runtime 状态；不能把遗漏当作空列表清理问答草稿。

每项包含 `id`（Core 生成的不透明标识）、`agentRunId`、`executionEpoch`、`questions[]`、`canSkip`、
`createdAt`、`expiresAt` 和 `status`。时间为 Core 的 Unix 毫秒；`expiresAt` 可为 null。Pi 每项只有一题。
问题包含 `id / kind / title / description / options / placeholder / prefill / multiline`；选项包含稳定 `id` 与原始
`label`。Host、Session、原生 ID 和答案编码留在 Core，不由 Renderer 构造原生 JSON。

| Pi 方法 | kind | 用户回答 | 原生响应字段 |
|---|---|---|---|
| confirm | confirm | 是／否 | confirmed: true／false |
| select | select | 点击原生选项标识 | value: 对应原始字符串 |
| input | input，multiline=false | 原始文本 | value |
| editor | input，multiline=true | 原始文本，保留 prefill | value |
| 四类的跳过 | canSkip=true | skip | cancelled: true |

标题、说明、选项和顺序、预填、换行与空白原样保留。空文本不等于跳过；否只表示显式回答 false。
不根据 `Type something.` 等文案增加能力或替插件构造下一题。select 回传原始选项后，只有真实 input
到达才显示文本问题；插件的多选文本也保持原文。`notify / setStatus / setWidget / setTitle / set_editor_text`
沿用原路径，不进入等待列表；不借此覆盖 Composer 草稿。
Pi 原生 select 不内置自填选项，也不声明它与后续 input 的关系；同一 Run 或工具调用不能成为关联两题的
协议依据。每条请求只展示自己的原生内容，不继承上一题的选择、标签或用户文本，不自动代答后续请求。

## 提交与归属

Desktop/Web 提交 `nativeInteractions.respond`，参数为：

```json
{
  "commandId": "original-client-command-id",
  "threadId": "thread-id",
  "agentRunId": "run-id",
  "executionEpoch": 1,
  "interactionId": "opaque-interaction-id",
  "answer": {"kind": "select", "optionId": "option-id"}
}
```

`answer` 是封闭联合：`confirm + confirmed:boolean`、`select + optionId:string`、`input + value:string`
或 `skip`。字段和原生方法必须匹配；选择标识必须属于该题。无任意原生 JSON 入口。
Core 检查 Thread/Run、执行 epoch、停止与终态、Host/Session owner、请求标识和期限，再在原 Runtime
的局部提交锁中完成写入。同一请求只能写入一次；并发或重复提交返回原有处理状态及 alreadyHandled 标记，界面显示“请求已处理”，不发送第二个答案。
成功后只保留本轮去重所需的原生 ID/状态等最小标记，清除问题正文；不新增数据库表、答案聊天消息或回答日志。

登记请求后事件读取继续。用户等待不结束运行，也不阻塞其他 Runtime 消息或停止入口。
Pi 原生回复没有 ACK；写入 JSONL（含换行及 flush）成功即返回 `sent` 或 `skipped`。
这只表示已发送，不表示插件采纳或任务成功。跳过的界面反馈是“已跳过，未提交回答”，不承诺后续继续。

## 期限、失败与恢复

Pi confirm/select/input 的正数原生 timeout 自原生读流接收时记录一次；`timeout: 0` 与未设置一样没有期限，
对应当前 Pi 不启动零值计时器的行为。editor 没有 timeout。
Core/Renderer 不生成默认期限、不延长或重置期限，不替 Pi 发送超时答案。过期请求移出待处理和数量，
Core 保留 `expired` 标记以拒绝迟到回答。已经开始并取得成功结果的提交不被前端时钟覆盖。

Web 的未结提交冲突只限制相同 `interactionId`，不同问题可分别提交。发送前本地拒绝或 Host 明确未准入
通过客户端错误标记 `requestNotSent` 回到普通失败反馈；原提交结果未知时仍禁止重发，不以新问题的提交代替核对。
问答草稿的保存与清理使用同一范围：公屏为 `threadId + public`，私聊为 `threadId + conversationId`。
每个面板只清理自己可见范围的草稿，不能用局部列表清理整个 Thread。

| 返回状态 | 含义 |
|---|---|
| sent / skipped | 原请求已完成原生通道写入；重复查询可返回同一状态 |
| failed | 已确认在写入之前失败，请求仍有效；保留草稿，原按钮可再次操作 |
| unknown | 写入/flush 出错，无法证明 Pi 收到或未收到；保留草稿并禁用再次提交 |
| expired / unavailable | 期限已过、请求不存在或运行不再有效；移除卡片，不重试 |

`commands.reconcile` 对该 operation 只查询当前 Runtime 标记，不写数据库、不回复 Pi。仍 pending 时返回
unknown receipt；已发送、跳过、过期、失效或原生写入未知时返回对应状态。前端连接中断沿用全局恢复与原命令
核对，不增加自动发送、原生 ACK、后台重试或答案重放。Core/Runtime 重启后旧等待失效，不恢复可作答的旧卡片。

停止先禁止新的用户回答，释放仍有效的原生对话等待，再等待 abort；原有 Host 清理负责退出失败边界。
系统清理使用取消回包，但不记录成用户主动跳过。Pi confirm 的取消向扩展返回 false 是原生接口限制，
Rovai 不宣称第三方扩展能够区分取消和否。

Pi 没有答案 ACK，也不为扩展自行触发的 AbortSignal 取消发送独立失效事件。Core 只依据收到的原生期限、
所属 Run/Host 生命周期和自身写入状态清理请求，不按后续文字或无关工具事件猜测题目已失效。
该原生边界不能用“已发送”宣称插件仍在等待或已经采纳答案。

## 渠道投影与答复

飞书、Lark 与钉钉复用同一个 Runtime 请求及提交锁。渠道 Host tick 从当前 PiRuntime 取得问题，
只为绑定到该 Provider 的公屏 Run 创建 `channel_delivery.delivery_kind=native_interaction`。
私聊 Run、错误 Thread、旧 epoch 或停止后的请求不能创建渠道卡片。
每个 interactionId 独立投递一张渠道卡片，保留独立 Outbox 记录及答复校验。新的原生请求创建新卡，不复用或
刷新上一题的卡片来展示下一题。去重、领取、有限次卡片发送/状态更新重试沿用现有 Outbox。
Migration 220 将 projection schema 从 169 升至 170，只扩展既有 delivery kind 与 bound-delivery CHECK；
不新建问卷表。payload 只保存请求/Thread/Run/epoch、时间、状态、根 delivery 与外部卡片标识，
不持久化问题或回答正文。问题正文只在实际发送时从 Runtime 内存读取。

以下接口只接受对应的可信渠道 Host，不开放给 Renderer、Web 或 Agent CLI：

| Provider | 读取卡片源 | 提交原生答案 |
|---|---|---|
| 飞书 | channels.nativeInteractions.source | channels.nativeInteractions.respond |
| Lark | channels.lark.nativeInteractions.source | channels.lark.nativeInteractions.respond |
| 钉钉 | channels.dingtalk.nativeInteractions.source | channels.dingtalk.nativeInteractions.respond |

source 参数为 `deliveryId / appId`，返回根 delivery、队员名称、当前 NativeInteraction，以及仅供钉钉
创建卡片/清理私有提示的已验证 Owner 平台 userId。respond 参数为
`deliveryId / interactionId / appId / externalMessageId / chatId? / operatorOpenId? / operatorUserId? / operatorUnionId? / answer`。
answer 与 Desktop/Web 的封闭联合相同；参数不接受任意原生 JSON 或用户声明的 local_user 身份。
Core 核对 Provider Host、已发布 Bot、Owner、绑定的 Thread/渠道会话、已投递的外部卡片及请求标识，
再复用同一 Run/epoch/Host/Session 校验与原生 writer。操作者只能来自可信平台回调外层；按钮和表单不能声明身份。
提交不经过持久化 Command receipt，避免保存回答正文；该提交走现有 control request 通道。

Desktop/Web 或渠道先写入成功后，另一入口只能读回已处理状态。成功/跳过/期限或运行失效的卡片更新
只更新该请求自己的卡片，不再次提交答案。状态结算与回调按 interactionId 串行，成功回调只返回反馈，卡片
终态沿用已有 Outbox；不引入跨请求关联或轮询刷新。钉钉 outTrackId 用于回调/更新，
carrierId 只用于 Robot recall，二者不能互换。答案先于初次投递结算时，后续 tick 补建关闭卡片的 update delivery。

明确提交失败只反馈错误，不重绘表单；内容继续留在客户端。原生写入结果 unknown 保留去重标记和客户端
表单，不用终态重绘清空草稿；再次点击只能核对该标记，不能再次写入。渠道没有答案重放或 Pi ACK 协议。
卡片回调超时不表示提交失败，也不能自动重发。固定截止时间直接消费 expiresAt；到期只更新卡片状态，
不发送默认答案。平台容量不足时整题提示在 Desktop/已登录 Web 处理，不截断选项、预填或用户答案。

飞书/Lark 使用直接生成的 Card JSON 2.0：confirm/select 点击即提交，input/editor 使用可提交空文本的
form，跳过是表单外的普通 callback。input/editor 仅展示当前输入题，不附带旧选择题的选项或标签。
钉钉沿用官方 Form 模板，以
`CHECKBOX_GROUP` 原生单选列表代替下拉选择；模板仍要求表单提交，不能将尚未验证的点击行为宣称为点击即答。
钉钉模板的跨企业可用性与客户端表单行为属于真实平台验收，
不能由本地 JSON fixture 或另一个同企业 Bot 推定，当前边界见[渠道实施记录](../versions/v1.72/pi-native-channel-interactions.md)。
