---
document_type: version-decisions
version: v1.30
lifecycle: current
last_updated: 2026-08-27
---

# v1.30 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前规范由链接的 Architecture、Contract、UI 与 Context 说明拥有。

<a id="v1-30-d01"></a>
## V1.30-D01：项目绑定是主人本机目录，不把外部成员提升为本地用户

### 背景

飞书群成员需要使用 Agent，但本机项目路径可以暴露源码、凭据和文件权限。authorized users、sender allowlist 或
飞书侧项目申请都会把消息身份误当成本机管理身份，也会把路径选择扩散到不受控渠道表面。

### 决定

Core 建立 owner-only `ProjectBinding` 目录；只有 `local_user` 可以维护路径和绑定/切换渠道会话。飞书只使用不透明
Binding ID。绑定后任意会话成员可通过私聊或显式 mention 使用 Agent；`ExternalPrincipal` 只表达作者、上下文来源
和回复目标，不获得任何主人能力。

未绑定消息只记录待绑定会话，不建立 Principal、Camp 或执行；主人绑定后发送者必须重发。当前规范见
[飞书渠道架构](../../architecture/feishu-channel.md#项目与会话)和
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#2-projectbinding-与渠道会话)。

### 后果

- 项目路径和选择入口始终留在本机 Renderer；
- 群成员使用 Agent 不需要维护第二套授权名单；
- 绑定不会把之前的消息变成迟到执行，安全边界可由 frozen binding 证明。

### 被拒绝方案

- **sender allowlist / 已授权用户：** 混淆消息准入与本机项目管理，并产生持续名册治理；
- **飞书项目 picker 或申请卡：** 会暴露本机目录和主人操作面；
- **绑定后自动回放首条消息：** 不能证明用户仍希望执行，也跨越 observation 时的授权事实。

<a id="v1-30-d02"></a>
## V1.30-D02：多 Bot 先聚合、再走统一原子 admission 与单根 FIFO

### 背景

同一飞书消息同时 mention 多个独立 Bot 时，每个 App 都可能收到相同事件。由第一个连接立即创建 Run 会遗漏目标；
由 Host 直接写 CampMessage/Run 会形成第二套发送事务。同一 Camp 并行接受多条根用户消息又会交错公共结果。

### 决定

第一条 observation 只建立 collecting aggregate。只有 canonical mentions 完整或全部预期 App observation 到齐，
独立 finalize 才可继续；payload mismatch 或三秒 timeout fail closed。Finalize 创建持久
`ChannelTurnRequest`，每个 Binding 同时至多一个 admitted root，后续 FIFO queued 且不进入 conversation。

真正提升调用 `CollaborationService.admit_external_channel_message`，复用本地用户发送的同一原子 admission，一次性
创建触发 CampMessage、CampTurn 和全部目标 Run。当前规范见
[飞书渠道架构](../../architecture/feishu-channel.md#入站聚合与串行准入)和
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#5-多-bot-入站聚合)。

### 后果

- 多 App 重试只得到一个请求和一张状态卡；
- queued 请求不污染 History/Context，Core 重启可从持久队列恢复；
- 不同 Camp 仍并行，同一根 Turn 内的多 Agent/A2A/Gather 仍按既有语义运行。

### 被拒绝方案

- **第一条 observation 直接 admission：** canonical target 集可能尚不完整；
- **Host 拼装 CampMessage/Run：** 绕过用户路径已具备的原子门禁；
- **把 queued 消息先放入 Timeline：** 会让后续 Turn 指令提前进入当前 Run 上下文。

<a id="v1-30-d03"></a>
## V1.30-D03：飞书 reply 永远冻结为当前消息的 ExternalQuote

### 背景

判断飞书 parent message 是否已经投影到当前 Camp 需要长期维护 external ID 到 CampMessage 的双向账本，并处理
编辑、撤回、跨 Camp、Bot 回声和未 mention 历史。该复杂度只为模拟 Rovai 本地 reply，却会让同一渠道回复出现
两种不可预测语义。

### 决定

任意飞书 `parent_id` 都只在本次入站读取一次并冻结为当前触发 CampMessage 的 Structured Content
`ExternalQuote`。被引消息不单独物化，飞书触发消息的 `replyToCampMessageId` 始终为空；external message ID 只在
有 TTL 的 dedup/aggregation/outbox transport 中使用。Core Context projector 通过 Formatter/Manifest 22 把 quote
投影进标准 `CURRENT_INPUT.message`，不接受 Host prompt override。

当前规范见 [ContextManifest Evidence v22](../../contracts/context-manifest-evidence-v22.md)、
[模型上下文变更说明](model-context-change-feishu-external-principal.md)和
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#4-externalprincipal-与-structured-content)。

### 后果

- 本轮唯一自然语言指令仍是一个可审计 CampMessage；
- 回复用户消息和 Bot 消息行为一致，缺失来源使用确定性不可读摘要；
- 不建立永久 external-message reply projection，也不污染 reference closure。

### 被拒绝方案

- **命中时内部 reply、未命中时 quote：** 结果依赖异步投影时序；
- **把被引消息建成第二条 CampMessage：** 未 mention 历史会进入公共会话；
- **Host 直接拼 Runtime prompt：** 绕过 Structured Content、Manifest 和 Runtime delivery evidence。

<a id="v1-30-d04"></a>
## V1.30-D04：群 Bot roster 复用 Camp Membership v1，普通群与话题采用不同扩张规则

### 背景

普通群直觉上所有在群 Rovai Bot 都属于同一 Camp；话题群若同步父群完整名册，则以后加入的新 Bot 会污染每个
历史话题。另建飞书专属成员表又会绕过 v1.29 的 lifetime fence、移除 cutover 与 reconciliation。

### 决定

Host 只提交所有 published Bot 的完整 `isInChat` 快照。普通群首次及后续都把 present roster 通过既有
`camp.member.add/remove` 与 exact source generation 同步。话题首次只使用当前 mentions，父群新增不自动扩张；
只有话题内显式目标或 A2A exact target 且其 Bot 仍在父群时，才按需调用同一 add。移出/停用统一走既有 remove。

当前规范见 [飞书渠道架构](../../architecture/feishu-channel.md#bot-roster-与-camp-membership)、
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#6-camp-创建roster-与-admission)和
[Camp Membership v1](../../contracts/camp-membership-v1.md)。

### 后果

- 动态成员沿用 membership generation/version、source binding 与 reconciliation；
- 普通群 roster 与 Camp 一致，历史话题保持最小成员集；
- roster 不完整、未知 App 或 absent target 都 fail closed。

### 被拒绝方案

- **飞书专属 add/remove：** 会形成第二套成员授权与收口；
- **父群 roster 广播到全部话题：** 历史 Camp 被无关 Bot 污染；
- **只信 botAdded/botDeleted delta：** 丢事件或乱序后无法证明完整当前集合。

<a id="v1-30-d05"></a>
## V1.30-D05：秘密与网络留在 Main，公开结果由 Core Outbox 可靠投影

### 背景

多 App Secret、WebSocket 和飞书网络重试属于桌面宿主能力；把 Secret 放进 Core/Renderer 会扩大暴露面。另一边，
若 Agent 输出由 Main 临时监听并直发，网络失败或重启会丢失已经提交的公共结果，也可能泄漏 Runtime 原始流。

### 决定

Main 使用 OS safeStorage 保存每 App Secret，Core 只保存 credential ref 和业务身份。公开输出和状态先由 Core 从
权威请求/CampMessage 投影为 durable ChannelDelivery；Main 使用 lease 领取、发送并回写结果。只有 Core 已提交
内容可以外发，实际作者使用其独立 Bot，不能用另一个 Bot 冒充。Renderer snapshot 删除 credential 和 Host-only
恢复字段。

官方 SDK 的单应用注册是当前可验证实现：连接账号和发布每名队员都使用互斥 QR attempt；不伪造一次扫码后台
批量创建能力。当前规范见 [飞书渠道架构](../../architecture/feishu-channel.md#输出恢复与秘密)和
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#7-channeldelivery)。

### 后果

- 飞书不可用不回滚或丢失 Core CampMessage；
- App 间故障隔离，重启后可恢复连接、queue card 和 Outbox；
- 当前交互诚实显示每个官方注册二维码，未来若引入受支持的账号级 provisioning API，需要新的凭据/协议决定。

### 被拒绝方案

- **Secret 存 SQLite 或返回 Renderer：** 扩大日志、诊断和 UI 注入暴露面；
- **直接转发 Runtime stream：** 可能泄漏推理/工具输出且没有公共消息 authority；
- **未验证的开放平台后台 Cookie 自动化：** 私有接口和 CSRF 变化无法形成稳定产品合同。
