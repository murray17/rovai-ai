---
document_type: model-context-change
version: v1.37
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray.xue
confirmed_at: 2026-09-01
last_updated: 2026-09-01
---

# 飞书富文本规范化与 Topic 结构父链去伪引用

本说明只处理两个已经由真实 Feishu Topic 输入与冻结 ContextManifest 证明的入站错误：Desktop Host
绕过 Lark SDK 已完成的消息规范化，再次递归遍历 raw `post` JSON；以及把独立话题群中指向 canonical
Topic root 的结构性 `parent_id` 当成用户显式引用。两者都会改变 AgentRun 的 `CURRENT_INPUT.message`，
因此即使实现属于 bug fix，也先按核心模型上下文变更治理确认本 revision。

## 变更前

### 1. 当前消息正文

Lark SDK 1.73.0 已把一条入站事件规范化为 `NormalizedMessage`：`post` 只选择一个 locale，元素 `tag`
按类型渲染，mention placeholder 被替换为显示名，当前接收 Bot 的 mention 被移除。Desktop Host 随后却在
`raw.message.content` 存在时忽略 `NormalizedMessage.content`，对整个 JSON 对象递归收集所有字符串：

```text
body = collectText(JSON.parse(raw.message.content)).join('').trim()
```

该遍历没有消息 schema 边界，会依次收集 `tag`、`user_id`、`user_name`、`text` 等元数据，也会同时遍历
`zh_cn`、`en_us`、`ja_jp` 等全部 locale。随后只按 raw placeholder 做字符串替换，无法删除已经被递归
拼进正文的 `tag` / identity / locale 副本。

对本次真实消息，冻结进 Camp 的正文是以下精确文本：

```text
at@_user_1药师寺惠 textat@_user_2雾切响子 textat@_user_3爱丽丝 你们报个数textat@_user_1药师寺惠 textat@_user_2雾切响子 textat@_user_3爱丽丝 你们报个数text
```

正确的消息语义原本只有三个受管 Bot targets 和一份文本 `你们报个数`。Core 仍按既有路径把冻结 targets
构造成 Structured `MemberMention`，所以正常 agent-facing 投影本应只有一组队员名和一份文本。

### 2. Topic root 的结构性 `parent_id`

Desktop Host 当前对所有场景使用同一条件：

```text
message.replyToMessageId != null -> 读取 parent 消息并创建 ExternalQuote
```

在独立话题群内，话题子消息会以 `root_id` 表示 canonical Topic，同时可以用同值 `parent_id` 表示消息
属于该 Topic。该相等关系是传输结构，不证明用户在编辑器中选择了“引用/回复”某条消息。当前实现仍读取
Topic root，并把它冻结成当前消息的 `ExternalQuote`。

因此本次真实输入的 agent-facing `CURRENT_INPUT.message` 精确包含：

```text
引用 Murray：
> at@_user_1药师寺惠 textat@_user_2雾切响子 textat@_user_3爱丽丝 你们报个数textat@_user_1药师寺惠 textat@_user_2雾切响子 textat@_user_3爱丽丝 你们报个数text

@爱丽丝 @雾切响子 @药师寺惠 各自生成一张图片给我
```

其中“引用 Murray”不是用户显式引用，quote body 又经过同一个 raw 递归遍历，叠加暴露了元数据和 locale
重复。

## 变更后

### 1. 当前消息只冻结 SDK 规范化正文

Desktop Host 的当前消息正文改为以下确定性流程：

1. `NormalizedMessage.content` 是正文唯一来源；`raw.message.content` 不再进入当前正文解析。
2. Lark SDK 已移除当前接收 Bot 的 mention。对 `NormalizedMessage.mentions` 中其余 mention，只有当该
   occurrence 的 `name` 属于本次已经冻结的 expected managed Bot names 时，Host 才从规范化正文中移除
   对应的一次 `@<name>` occurrence；普通人类 mention 保留。
3. 移除后继续沿用既有空格折叠与首尾 Unicode whitespace trim；不增加正文翻译、locale 合并或第二套
   富文本解释器。
4. `raw` 事件仍可用于 tenant/sender identity、stable mention identity 与诊断摘要，但不再拥有模型正文。

三个 Bot 各自收到同一条消息时，SDK 只会预先移除“当前接收 Bot”；第 2 步再移除其余两个冻结 target
occurrence，使三条 observation 的 `body` 都精确为：

```text
你们报个数
```

Core 继续按已有 `canonicalAgentIds` 构造 Structured mentions。该消息新写入后的 agent-facing 投影精确为：

```text
@爱丽丝 @雾切响子 @药师寺惠 你们报个数
```

不会出现 `tag`、`user_id`、placeholder key 或第二个 locale 副本。

### 2. 被显式引用消息使用单 locale、schema-aware 规范化

Host 通过 Feishu `message.get` 读取真正需要引用的消息时：

1. `text` 与 `post` body 复用当前锁定的 Lark SDK 1.73.0 message normalizer；构造规范化输入时使用返回项的
   `msg_type`、`body.content` 和 `mentions`，并设置 `stripBotMentions=false`，因为引用原文必须保留作者当时
   写出的 mention。
2. `post` 因而只选择一个 locale，优先级保持 SDK 的 `zh_cn -> en_us -> ja_jp -> first object`；只按 SDK
   支持的 element schema 渲染正文，不递归收集 `tag`、`user_id`、`user_name` 或其他对象字段。
3. 其他消息类型、附件摘要、不可读取占位、Core 的 8,000 Unicode-scalar quote body 上限和 20 个附件摘要
   上限保持既有行为。

若用户在同一 Topic 中真正回复了一个非 root 父消息，引用正文仍会存在；上例 Topic root 被显式引用时，
quote body 只会是以下单份规范化文本：

```text
@药师寺惠 @雾切响子 @爱丽丝 你们报个数
```

### 3. Topic 结构父链不生成 ExternalQuote

Host 在已有 `conversationKind` 与 canonical `topicKey` 已经确定后，按以下完整条件选择 quote：

```text
structuralTopicParent =
  conversationKind == "topic"
  && topicKey != ""
  && message.replyToMessageId == topicKey

quoteMessageId =
  message.replyToMessageId != null && !structuralTopicParent
    ? message.replyToMessageId
    : null
```

结果闭集为：

| 场景 | `ExternalQuote` |
| --- | --- |
| p2p/group 有 `parent_id` | 保持创建 |
| Topic 中 `parent_id == canonical root_id` | 不创建；这是结构父链 |
| Topic 中 `parent_id != canonical root_id` | 保持创建；这是非 root 的直接父消息 |
| 没有 `parent_id` | 不创建 |

本次当前输入的新写入结果精确为：

```text
@爱丽丝 @雾切响子 @药师寺惠 各自生成一张图片给我
```

不再出现 `引用 Murray：`。如果 `parent_id` 指向 Topic 内另一条非 root 消息，则仍按既有 ExternalQuote
格式投影为 `引用 <sender>：`、逐行 `> `、空行、当前 Structured mentions 与正文。

## 明确不变

- Owner-only admission、Bot roster、multi-Bot aggregate、canonical target 解析、三秒 finalize、FIFO、
  PendingCampBinding、Camp/Turn/Run 创建与 ExternalPrincipal source 不变。
- Topic identity 仍是 `provider + tenant + chat + canonical topic`；普通 group thread 继续在 observation 前
  静默拒绝，Topic 出站仍 reply canonical root。
- `ExternalQuote` segment shape、digest、agent-facing `引用 <sender>：` 格式、8,000 字符/20 附件上限和
  channel-only 构造权不变；只修正何时创建以及 quote raw body 如何规范化。
- `channel_inbound.observe` JSON shape、Core command、Schema、SQLite 表、Migration、CampMessage structured
  segment shape 与 `replyToCampMessageId = null` 不变。
- `CURRENT_INPUT` section 名称、顺序、source shape、History/Task/Gather 选择、Profile 4 预算、附件路径、
  `mentionsCurrentUser`、ContextManifest shape 与 Runtime Input Delivery Evidence shape 不变。
- Native Session Bootstrap、Session Charter revision 5、Bootstrap Formatter 3、AgentRun Formatter 22、
  ContextManifest 22、Context Delivery Profile 4、Run Facts 2 和 Built-in Tool Transport v21 不变。
- 不回填或重写已经冻结的 CampMessage、PendingCampBinding、ChannelTurnRequest、ContextManifest、Runtime
  input 或历史 Evidence；本次已出现的错误文本仍作为历史事实保留。

## 合同、迁移与恢复

- 当前 Feishu Channel 合同从 v10 前进到 v11：v11 继承 v10 的执行卡/LAN 只读面，并精确拥有本说明的
  current-body authority、single-locale quote normalization 与 Topic structural-parent quote gate。
- 飞书渠道 Architecture 同步把“任意 `parent_id` 都是 ExternalQuote”改为上述场景闭集；v1.35 的
  V1.35-D03 历史正文不改写，由当前版本新决定 V1.37-D06 只取代其“Topic root structural parent 也引用”部分。
- `docs/decisions/CURRENT.md`、v1.37 概览与实施计划在确认后同步当前合同和验证事实。
- 无数据库迁移、双写、历史回填、Binding compatibility digest 或 Native Session 轮换。已经持久化的
  collecting aggregate 继续使用其冻结 payload；升级边界上若同一外部消息混入新旧两种 observation，既有
  canonical-payload equality 会 fail closed，不把两种正文合并。用户可重新发送该条消息。
- 新入站 CampMessage 的 content/projected-body/dynamic-context digest 与 Runtime Input Delivery Evidence
  覆盖修正后的实际字节；旧 digest 和实际投递证据不变。

## 验证

- 扩展 Desktop Channel Host owner，给出含两个 locale、四个 `at` element 与 `tag/user_id/user_name/text`
  字段的 raw `post`，同时提供 SDK 已规范化的 `NormalizedMessage.content`；修复前复现当前精确脏文本，
  修复后断言三 Bot observation 的 `body` 都精确为 `你们报个数`。
- 在同一 owner 中证明普通人类 mention 保留，受管 Bot occurrence 只按冻结 mention 次数移除，不把任意 raw
  metadata 或第二 locale 带入 body。
- 扩展 Topic owner：`rootId == replyToMessageId` 时不调用 `message.get` 且 command 没有 `quote`；
  `rootId != replyToMessageId` 时读取一次并冻结 quote。
- quote fixture 返回含多 locale 与 `at/text` elements 的 `post`，断言只保留一个 locale 和人类可读 mention，
  不含 `tag`、`user_id` 或 locale 重复；保留读取失败占位负向路径。
- 运行 `pnpm exec vitest run apps/desktop/src/main/channel-settings.test.ts`、`pnpm typecheck`、`pnpm test`、
  `pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check`、固定 base SHA 的 `pnpm docs:check:ci`、
  `git diff --check`。本修复不启动 Core、Electron 或真实 Runtime，不写日常 SQLite，不发送真实飞书消息。

## 二次确认

开发者在阅读 revision 1 的完整前后字节、Topic quote 场景闭集、不变边界和历史不回填策略后，于
2026-09-01 明确回复“确认”。本记录只授权实施本文定义的飞书入站规范化与 Topic structural-parent
quote gate，不授权修改其他渠道、Context section/shape、历史 Evidence 或回填既有消息。实现从本确认记录
之后开始。

## 实际实施

已按 revision 1 实施：`canonicalInboundBody` 删除 raw body parser，只消费 SDK `NormalizedMessage.content`，
并按 normalized mention occurrence 删除其余冻结 target；Topic quote selection 在读取前排除
`replyToMessageId == topicKey`。真正读取的 `text | post` quote 通过 SDK `normalize` 与
`stripBotMentions=false` 生成，兼容 `message.get` 的 string `id + id_type` mention shape；无类型递归
`collectText` 已删除。

[Feishu Channel v11](../../contracts/feishu-channel-v11.md)、[飞书渠道架构](../../architecture/feishu-channel.md)、
[V1.37-D06](decisions.md#v1-37-d06)、当前决定/合同/版本/UI 路由与实施计划已同步。未修改 Core command、
SQLite、Migration、Structured Content、Context formatter/profile/manifest 版本或 Bootstrap。

两个新 owner 在旧实现上先分别得到 raw metadata/双 locale 脏正文，以及 Topic structural root 被读取的失败；
修复后 `channel-settings.test.ts` 53 项通过。`pnpm typecheck`、`pnpm test`（134 个 Vitest 文件 / 1375 项；
Node 221 项中 220 通过、1 项既有 Windows 检查按平台跳过；文档 9 项、Skill 3 项）、`pnpm build:desktop`、
`pnpm docs:test`、`pnpm docs:check`、固定 base `04ae35ffb03da83f96eb9e750303dfa6c9b23395` 的
`pnpm docs:check:ci` 与 `git diff --check` 均通过。没有启动 Core、Electron、真实 Runtime 或真实飞书连接，
没有读取或写入日常 SQLite，也没有发送渠道消息。
