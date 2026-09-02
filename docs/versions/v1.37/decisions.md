---
document_type: version-decisions
version: v1.37
lifecycle: historical
last_updated: 2026-09-02
---

# v1.37 决定

<a id="v1-37-d01"></a>
## V1.37-D01：Runtime 图片采用结构化来源与混合生命周期，不升级为文件发布

### 背景

稳定 Runtime 图片路径可直接使用，但本机 Run 临时目录必然清理；有些 Runtime 同时返回 bytes 与 path。
把所有图片转成消息附件会混淆中间结果和显式交付，并把本机可视化带到飞书；把所有路径复制或新增目录授权
又会显著扩大实现和交互。用户明确要求可用性优先、最小验证及不限制目录/符号链接。

### 决定

只接收已适配的结构化结果。稳定路径引用原文件，inline bytes 始终保存，仅 Run 临时路径为生命周期保存到
现有 Blob。普通文件检查与真实解码构成最小读取链；失败局部降级。图片拥有独立 Run 元数据，不自动产生
CampMessage/Attachment/渠道投递。当前规范由 [Runtime 图片架构](../../architecture/runtime-images.md)与
[Runtime Images v3](../../contracts/runtime-images-v3.md) 拥有。

### 后果与替代方案

- 保留零拷贝意味着稳定文件修改/删除会改变或失去预览，这是接受的取舍，不承诺历史 bytes 不变。
- 拒绝路径一律优先：会丢失已有 inline bytes，且临时文件清理后不可恢复。
- 拒绝全部复制：稳定文件无需额外副本；拒绝全不保存：Run 临时结果会必然丢失。
- 拒绝自动 Attachment/文件预览授权框架：图片观察不是交付，扩大领域状态与交互不解决本次问题。

<a id="v1-37-d02"></a>
## V1.37-D02：取消以业务事务为终态边界，Runtime 清理独立且有界

### 背景

实际半取消由 Input 回调推进 Run version 后，旧 cancellation ACK 被 version fence 拒绝引起。重试又以相同
command ID 携带新版本 payload，永久触发幂等冲突。单纯放宽版本或更换重试 ID 仍让会话可用性依赖失联 Runtime。

### 决定

取消事务直接结算业务 Run、义务和受影响 Turn；Runtime 使用既有 active/launch permit 和受管进程后台清理。
新增最小发送 timestamp 区分尚未发送与可能接受；取消原因拥有业务终态，目标 Run 一律为 cancelled，Input/Action
未知证据留作审计且禁止重发，不升级为公共失败或待确认提示。成员离队完全保留既有定向 cutover 集合，单 Run/
离队不关闭整轮渠道；整轮取消抑制重试并允许下一渠道请求推进。

当前权威为 [Cancellation Settlement v2](../../contracts/cancellation-settlement-v2.md)及其专属合同；
模型上下文边界已按[revision 2](model-context-change-cancellation.md)确认。

### 后果与替代方案

- 取消仍不证明进程退出、Input 未发送或效果回滚；底层证据保留，但不再把用户明确停止后的 Run 显示为失败或
  “外部效果待确认”。同 Conversation 清理无法确认时，新 Run 仍有界失败，牺牲该次自动启动以避免旧新执行重叠。
- 拒绝继续修补异步 ACK：无法消除失联进程对业务完成的依赖，也保留重复领域命令的冲突面。
- 拒绝新增通用依赖图、额外 Input 状态协议或每 Run 工作目录隔离：现有持久关联足以界定离队范围，发送前一个
  条件更新足以界定未知证据；扩大模型不能消除本次根因。

<a id="v1-37-d03"></a>
## V1.37-D03：Agent 目标教学收敛到 `--to`，inline alias 只扩展连续有效前缀

### 背景

旧 parser 只识别逻辑行首的一个 exact display-name alias，导致自然生成的 `@惠 @响子` 只投递首位队员；
同时把完整 alias grammar 写入 Agent `body` help 会与稳定 canonical `--to agent_N` 入口竞争。把 cluster 内
未知 token 升级成新错误又会收紧旧行为，使原本可发布的正文被整体拒绝。

### 决定

Agent `body` help 只保留 payload 说明，canonical `--to` 是唯一推荐目标 authoring 入口。Core 继续把 inline
addressing 当兼容与运维兜底：从逻辑行首连续解析由空白分隔的有效 canonical/exact active-member mention，
保留 occurrence 顺序并按 canonical ID 去重 Delivery。第一个未知、歧义或普通文本终止 cluster；相关
display-name lookalike 保持 Text 且不新增发送拒绝，后续 canonical token 延续既有 mid-line 语义。既有
malformed canonical token 与全部 recipient admission 保持不变。

### 后果与替代方案

- 同一行可稳定表达多个现有队员，同时不把 alias 变成公开 Agent authoring 接口；catalog digest 按既有 Binding
  compatibility 轮换，不增加 wire、schema shape、数据库迁移或 Session Charter revision。
- 拒绝继续“一行一个 alias”：它把普通多 mention 截断成部分投递。拒绝任意 mid-line alias：会把叙述文本误当
  调度。拒绝 invalid-tail 原子失败：这是旧行为没有的新严格度，无法为兼容兜底带来相称收益。
- 当前规范由 [Camp Message Send v19](../../contracts/camp-message-send-v19.md)、[Public A2A Message Delivery](../../architecture/public-a2a-message-delivery.md)
  与[确认 revision 3](model-context-change-multi-mention-cluster.md)共同拥有。

<a id="v1-37-d04"></a>
## V1.37-D04：具体文件点击直接形成临时文件能力，不自动升级目录授权

### 背景

文件引用已经明确表达用户要打开的目标，但旧实现仍以 Camp/project root containment 作为普通文件读取前提。
工作区外的 `~/.codex/config.toml` 或 sibling worktree HTML 因而返回 `authorization_required`，Renderer 随即弹出
目录选择器。该流程把一次具体文件意图扩大成目录授权，也让用户必须理解内部 Root Grant；另一方面，完全取消
路径能力会使 HTML 本地资源和 Markdown 相对链接无法安全延续。

### 决定

Core 继续拥有来源映射，Main 在可信点击最终定位到现存普通文件后签发窗口/Camp 绑定的临时具体文件 handle；
canonical file 可以位于来源 root 外，不生成 Root Grant，也不触发目录选择。支持格式直接预览，不支持格式交给
系统默认应用。HTML/Markdown 的自动资源 token 单独绑定当前文档目录并随 Tab 释放；可信子链接点击再获得自己的
具体文件 handle。Root Grant 只保留给选择目录、打开文件夹、添加外部目录或浏览目录等明确目录操作。

当前规范由 [File Preview v3](../../contracts/file-preview-v3.md)、[File Preview Architecture](../../architecture/file-preview.md)
与[Camp 文件预览区](../../ui/components/file-preview.md)拥有。

### 后果与替代方案

- 文件是否位于工作区内不再制造交互差异；描述符恢复、刷新和系统动作重新验证同一来源与 canonical identity，
  失败只反馈无法打开，不把 capability 原因暴露给用户。
- HTML 自动资源获得文档目录内的临时读取范围，这是支持真实本地交互稿的必要扩大；token、sender、generation、
  containment、MIME/大小门禁和 Tab 生命周期共同限制该范围，不能转成持久目录授权。
- 拒绝继续要求 Root Grant：它增加无效 Modal，并把单文件意图扩大成目录能力。拒绝对点击文件永久信任：来源撤销、
  文件替换或身份变化后仍须失败。拒绝让 HTML 直接使用 `file://`：它绕过受控协议、sender gate 与资源释放边界。

<a id="v1-37-d05"></a>
## V1.37-D05：飞书执行卡使用固定直达 URL，局域网执行台以链接持有能力授权

### 背景

把执行过程继续塞进群卡会重复 Rovai 执行台、频繁改卡并受卡片预算限制；把“打开执行台”改成 callback、Owner 私聊与
点击时签发又会引入外部身份、私聊幂等和地址刷新状态机。Card 2.0 的纯 `open_url` 无法在点击时先向 Rovai 请求最新地址，
而一期明确只服务受控局域网内主动开启的只读查看，不承诺抵抗局域网主动中间人。

### 决定

飞书执行卡只保留状态和三个入口：最近输出与 exact-run 停止继续做 Owner callback；打开执行台使用创建卡片时冻结的
`open_url`，不识别点击人。Desktop Main 运行一个全局 LAN HTTP/SSE 服务，按用户固定端口签发内存随机 Token，scope 只允许
同渠道/App/Camp/队员中 focus Run 及其之前历史。IP 或端口变化不更新旧卡；Main 重启不恢复 Token。链接、局域网可达性和
有效 Token 共同构成只读查看能力，不把它描述成 Owner-only。

执行卡与只读页面的原决定由 [Feishu Channel v10](../../contracts/feishu-channel-v10.md) 收敛；当前字段、入站规范化、
设置默认与监听门槛由后继 [Feishu Channel v12](../../contracts/feishu-channel-v12.md) 拥有，并由
[V1.37-D06](#v1-37-d06)与[V1.37-D08](#v1-37-d08)修订。组件边界与 UX 分别由
[飞书渠道架构](../../architecture/feishu-channel.md)和[渠道设置](../../ui/components/channel-settings.md)拥有。

### 后果与替代方案

- 旧卡在 IP、端口或网络变化后可能失效，后续新卡才使用新地址；这是避免 address generation、批量卡片迁移和私聊恢复的
  明确代价。
- 获得链接且能进入局域网的人可以查看冻结 scope；HTTP 不能为主动攻击者提供保密保证，因此 Token 只减少偶然发现和
  越权扩张，不把能力包装成 HTTPS 或飞书身份认证。
- 拒绝继续把完整 timeline 放在卡片：它增加解释层、折叠/分页与持续更新复杂度。拒绝动态 callback/私聊：它违背直接打开
  的产品行为，并没有解决 HTTP 主动攻击。拒绝每 Run 端口或冲突漂移：旧卡与运行时地址将变得不可预测。

<a id="v1-37-d06"></a>
## V1.37-D06：飞书当前正文只信 SDK 规范化结果，Topic root 父链不等于引用

### 背景

真实 Topic ContextManifest 证明了两个相互叠加的错误。Lark SDK 已经对 `post` 选择单 locale、按 element
类型渲染并解析 mention，Main 却再次递归遍历 raw JSON，把 `tag`、`user_id`、`user_name` 和所有 locale
拼进正文。独立话题群又会用与 canonical `root_id` 相同的 `parent_id` 表达结构归属，旧规则却把任意
`parent_id` 都冻结成 ExternalQuote，于是没有显式引用的消息也显示“引用 Murray”。

### 决定

当前消息正文只使用 SDK `NormalizedMessage.content`；Main 仅逐 occurrence 删除本轮其他受管 target 的
可见 mention，使所有接收 Bot 提交相同 body。真正读取外部父消息时，`text | post` 复用同一锁定 SDK
normalizer、保留原文 mention 且只选择一个 locale。Topic 中 `parent_id == canonical root_id` 定义为
structural parent，不读取、不创建 ExternalQuote；p2p/group parent 和 Topic 非 root parent 保持一次读取与
ExternalQuote。

当前字段与行为由 [Feishu Channel v11](../../contracts/feishu-channel-v11.md) 拥有，组件边界由
[飞书渠道架构](../../architecture/feishu-channel.md)拥有，模型可见前后字节按
[确认 revision 1](model-context-change-feishu-ingress-normalization.md)实施。本决定只取代历史 V1.35-D03
把 Topic root structural parent 也视为引用的部分，不改写其余外部引用理由。

### 后果与替代方案

- 新消息不再携带 raw metadata、placeholder 或多 locale 副本；历史 CampMessage、Manifest 与 Runtime input
  不回填。升级边界的同一 aggregate 若混入新旧 payload，继续 fail closed，可能需要用户重发一次。
- 保留 Topic 非 root parent 的引用能力，代价是仍依赖飞书 `parent_id/root_id` 的精确关系；没有额外 UI
  inference、外部 message 映射或内部 reply chain。
- 拒绝修补递归 `collectText` 的字段黑名单：Feishu element 与 locale schema 扩展会继续把元数据误当正文。
  拒绝在所有 Topic 中一律丢弃 `parent_id`：会同时删除真实的非 root 直接回复。拒绝回写历史消息：会破坏
  已冻结的 Context/Evidence digest，且无法可靠恢复用户当时的完整 provider 语义。

<a id="v1-37-d07"></a>
## V1.37-D07：渠道维护采用事件快路径与按需十分钟 watchdog，不建立通用工作日志

### 背景

飞书和钉钉 Main 原先永久每 750ms/800ms 调用一次全量 Host tick，即使当前 App 从未使用渠道或所有渠道工作早已
收口也持续扫描。完全删除兜底则会让进程内 Core event、WebSocket 或 settlement 唤醒的偶发丢失再次造成执行卡和
Delivery 永久停留。另一方案是增加 `channel_work_item/deadline journal` 或长期 `waitAndClaim`，但现有 Request、
Delivery、Console、Aggregate 和 PendingBinding 已分别持久化状态与 deadline，通用表会复制权威并引入双写一致性。

### 决定

保留现有 `channels.host.tick` 作为数据库 level-triggered 恢复真源，并让响应按 provider 返回
`hasOutstandingWork`。Main 每个 generation 只做一次启动恢复探测；入站、会改变渠道状态的卡片、Bot/roster、
AgentRun/Runtime event 和 settlement 触发串行合并快路径。只有 Core 仍报告未收口工作时才武装可撤销的十分钟
one-shot watchdog；清空后完全休眠。终态用独立 one-shot 跨过 900ms quiet window，retry 按 settlement 的
`availableAt` 唤醒。每张执行卡在 Core 只允许一条 pending/attempting upsert，attempting 期间只推进 latest sequence，
成功 settlement 落后时再创建一次 follow-up。Core event 只优化延迟，不承担可靠队列语义。

当前 wire、状态集合、竞态与恢复上限由 [Channel Host Maintenance v4](../../contracts/channel-host-maintenance-v4.md)
拥有；Provider 组成见[飞书](../../architecture/feishu-channel.md)与[钉钉](../../architecture/dingtalk-channel.md)架构。

### 后果与替代方案

- 空闲 App 仅有一次启动探测，没有常驻渠道扫描；活跃期间 live event 最多 500ms 合并一次，终态和短重试不等待
  十分钟兜底。`deliveries=[]` 不能作为静默依据，停止只相信 Core 的 provider-scoped 领域事实。
- 完全漏掉快路径时，恢复最多延后约十分钟；已过期 lease 还需等到该次 watchdog。这是用较低空闲写事务换取的明确
  延迟，不能据此缩短领域 lease 或丢弃 deadline。
- 拒绝仅把旧 interval 改成永久十分钟：即使无渠道工作仍会扫描，正常状态更新也会延迟。拒绝完全 event-only：
  进程内通知没有持久 cursor，无法证明不丢。拒绝通用 WorkItem/waiter：当前规模下会增加新调度子系统与权威复制，
  而不能比现有领域表提供更多恢复事实。

<a id="v1-37-d08"></a>
## V1.37-D08：局域网执行台默认开启但由已发布渠道 Bot 门禁监听

### 背景

局域网执行台已是飞书执行卡的直接只读入口，但原先要求用户先进入渠道设置并主动开启；首次安装在没有设置文件时，
执行卡无法生成打开入口。用户确认希望该能力默认可用，同时已有用户明确保存的关闭选择不能被新默认值覆盖，配置损坏
也不能因为产品默认开启而意外暴露 listener。没有任何已发布渠道 Bot 时不会产生执行卡链接，提前占用端口没有收益。

### 决定

缺少 `execution-web.json` 时，Main 使用不落盘的 `{ enabled: true, port: 8765 }` 首次默认值。该值只表达设置意图；
只有权威渠道设置快照中至少一个 Bot 当前为 `published` 时才允许绑定私有 RFC1918 地址。没有已发布 Bot 时使用
`no_published_bot` 且不解析网卡或创建 server；首个 Bot 发布后自动尝试监听，最后一个退出已发布状态时关闭 listener、
终止流并撤销 Grant。有效持久设置仍是唯一权威，保存为关闭的用户保持关闭；内容无效、无法解析或无法读取的设置文件
继续失败关闭为 `{ enabled: false, port: 8765 }` 并暴露降级。端口冲突或没有私有地址时保留 `enabled: true`，
只把 listener 状态标记为不可用，不漂移端口、不自动关闭。

当前字段、优先级和兼容边界由 [Feishu Channel v12](../../contracts/feishu-channel-v12.md) 拥有；组件状态与 UX 分别由
[飞书渠道架构](../../architecture/feishu-channel.md)和[渠道设置](../../ui/components/channel-settings.md)拥有。

### 后果与替代方案

- 首次启动且没有已发布 Bot 时不会绑定端口；Bot 发布后页面仍须持有卡片 URL 中的内存 Token，保持只读 scope、
  安全响应头和 Main 重启撤销，不把默认开启描述成公网分享或 Owner 身份认证。
- 不写入缺省文件使首次默认可以独立演进，也避免伪造一次用户选择；用户保存后，持久值在后续启动中优先。
- 拒绝把损坏配置也回退为开启：无法区分用户意图与磁盘异常。拒绝迁移所有既有 `false`：会覆盖明确选择。
  拒绝在没有已发布 Bot 时预热端口：没有可签发的入口却扩大监听面。拒绝端口冲突后自动漂移：会破坏固定 URL 与
  旧卡可预测性。

<a id="v1-37-d09"></a>
## V1.37-D09：钉钉复用飞书的状态卡与单一 LAN 执行台，不补 Topic 或第二套 Web 服务

### 背景

钉钉已有账号、独立 Bot、Stream、Owner、普通群 roster、统一 admission、FIFO 和 Outbox，但当前渠道页隐藏入口，
执行卡仍把 live 正文流入 AI 卡并在终态做 Owner 分页。用户已明确以一个已发布 Bot 重开真实验收，并要求执行中固定为
“显示最近输出 / 打开执行台 / 停止执行”三个按钮。另起 DingTalk H5、每 Run 端口或点击跳转服务会复制飞书已经收口的
公开投影、Token、SSE 和生命周期；把 URL 也改成 callback 又会重新引入 Owner 私聊、动态地址和消息幂等。

### 决定

渠道页恢复飞书/钉钉两个真实 Provider Tab。钉钉普通群项目卡增加 Quick Chat；Topic/Thread 继续 fail closed，直接多 Bot
和附件 gate 不扩大。执行卡采用与飞书相同的状态入口语义：最近输出与 exact-run 停止为 Owner callback，打开执行台为
卡片创建时冻结的直接 URL action。飞书和钉钉共用 Desktop 唯一 `ExecutionViewService`、全局端口、内存 Token、
immutable Camp/Agent/focus-history scope 与 SSE；Core Web snapshot 只接受冻结 Channel conversation 所属的 closed provider set。

Main 为每个 DingTalk Run 保存临时 URL、展开状态、最新 source 和摘要，所有 delivery/callback/终态更新按 Run 串行。
停止使用 callback message identity 的稳定命令 ID，DingTalk Host alias 进入同一个 provider-neutral Core exact-run command；
成功后立即把当前卡投影为“已取消”，Outbox 仍负责最终恢复。最近输出最多 30 条公开正文和安全 command，不含 result；
收起状态不因 Evidence 增长更新卡。字段与验证边界由
[DingTalk Channel v6](../../contracts/dingtalk-channel-v6.md)拥有。

### 后果与替代方案

- 获得固定 URL 且能访问本机局域网的人可以读冻结 scope；它不识别 DingTalk 点击人，IP/端口变化不修旧卡，Main 重启
  使 Token 失效。这与飞书当前 LAN HTTP 取舍一致，不把 HTTP 描述成主动攻击防护。
- DingTalk AI 模板负责 URL/Callback 按钮的跨端表现；真实 Mac/手机必须验证 RFC1918 HTTP、fragment、operator userId、
  SSE 与停止终态。测试未完成前只记录实现就绪，不声称 packaged/真实租户通过。
- 拒绝保留旧 streaming/终态分页：它与“纯状态入口”冲突且持续制造卡片更新。拒绝 DingTalk 专属 Web 服务或 WebSocket：
  同一公开 projection 和 SSE 已满足需求。拒绝为了体验表面对齐实现 Topic fallback、附件或同消息多 Bot：这些能力缺少
  独立身份、下载/投递和 canonical target 证据，风险与三个按钮无关。

<a id="v1-37-d10"></a>
## V1.37-D10：共享紧凑 command 标签，但结果只进入飞书原生折叠面板

### 背景

真实钉钉卡片已经能呈现三个入口，但内置 AI 模板只提供整个 `staticMsgContent` 区域，无法像飞书 Card 2.0 一样为每条
command 提供原生折叠。把 command result 全量平铺到钉钉会显著拉长群卡；完全不在飞书最近输出中提供结果，又浪费了
已经验证的原生 `collapsible_panel`。两端还会遇到超长 shell command 挤占卡片宽度的问题。

### 决定

飞书最近输出中的每条 command 使用默认收起的原生面板，面板内只放既有安全 `publicResult` 的最多两行紧凑预览；
钉钉继续使用整个最近输出区，不展示 command result，也不模拟逐条折叠。两端共用先 redaction、后按约 72 个终端显示列
截断的 command 标签，显示状态符号和 `$`，保留命令开头与目标尾部。完整安全 command/result 继续由只读 Web 执行台
承担。新发布钉钉 Bot 的默认描述同时统一为 `Rovai AI Teammate · <teamRole>`，但不修改或重建已有远端应用。

当前字段与预算由 [Feishu Channel v13](../../contracts/feishu-channel-v13.md)和
[DingTalk Channel v7](../../contracts/dingtalk-channel-v7.md)拥有。

### 后果与替代方案

- 飞书 Owner 展开的是群卡共享内容，不是私有结果面；因此只允许既有公开结果投影，不能从 raw Evidence、输入或本地详情
  回退。Card 2.0 继续受 50-element/24 KiB 预算约束，超限时淘汰最旧最近项。
- 钉钉与飞书的“最近输出”不追求组件完全同形，但保持相同入口、顺序、command 文案和安全范围；平台能力差异只落在
  结果 disclosure，不复制自定义 H5 卡片或 callback 状态机。
- 拒绝在钉钉平铺两行 result：不可折叠的结果会让高频命令重新变成执行日志流。拒绝按像素或设备型号动态测量：卡片
  字体和宽度由客户端控制，近似显示列更稳定，也不需要增加远端探测。

<a id="v1-37-d11"></a>
## V1.37-D11：钉钉群目标使用 Bot 身份证明，首次发布发送非阻断欢迎卡

### 背景

钉钉普通群 callback 的 `atUsers` 同时包含 receiving Bot 和其他被 @成员；旧入口把“恰好一个 atUsers”当成单 Bot
证明，导致合法群消息在进入 Core 前静默丢弃。钉钉回调同时提供 `chatbotUserId`，可与 `atUsers[].dingtalkId` 精确匹配。
另一个体验缺口是队员发布完成后，Owner 只能从 Rovai 设置页判断是否可用，不知道渠道私聊已经就绪。飞书和钉钉在发布
阶段都已经确认 exact Owner 平台身份，可以主动发卡，但为一次欢迎通知增加持久 Outbox 会复制 publication 状态。

### 决定

钉钉普通群以 `isInAtList=true` 且 `chatbotUserId` 出现在 `atUsers[].dingtalkId` 作为当前 receiving Bot 的 canonical
证明；其他普通成员 mention 可以共存，不形成 Agent target。多个 Rovai App 的独立 Stream 实际接收同一消息时仍在
3 秒窗口后整条 fail closed。私聊保持按 receiving App 直接创建/复用 Quick Chat，不增加项目选择。

飞书和钉钉的新 Bot 在 publication durable completed 后，使用刚确认的 Owner `openId/userId` 主动发送一张无操作私聊
欢迎卡，文案说明可以直接私聊、入群后需 @Bot。消息 ID 从 publication intent 稳定派生；失败只记录脱敏诊断，不回滚
发布。completed Bot 的启动、凭据恢复或连接核对不补发，也不新增欢迎消息 Outbox/receipt。渠道页 Provider 标识改用本地
打包的真实品牌图标，未发布身份说明收敛为“发布后沿用队员身份”。

当前字段与行为由 [Feishu Channel v15](../../contracts/feishu-channel-v15.md)、
[DingTalk Channel v10](../../contracts/dingtalk-channel-v10.md)、[飞书渠道架构](../../architecture/feishu-channel.md)、
[钉钉渠道架构](../../architecture/dingtalk-channel.md)和[渠道设置](../../ui/components/channel-settings.md)拥有。

### 后果与替代方案

- 同时 @Bot 与普通成员的钉钉群消息恢复响应；缺失或不匹配 Bot identity 继续 fail closed，普通成员 ID 不进入模型或日志。
- 欢迎卡是首次发布的可用性提示，不是业务状态真源；极端网络失败可能缺失，但不会把已经可用的 Bot 标成失败或重复建 App。
- 拒绝只放宽为 `atUsers.length >= 1`：它无法证明 receiving Bot。拒绝让私聊也选项目：用户已确认私聊继续 Quick Chat。
  拒绝为欢迎卡增加数据库状态机：它的可靠性价值不足以复制 publication 与 provider 去重事实。

<a id="v1-37-d12"></a>
## V1.37-D12：钉钉群目标以 exact Stream App 与明确 @事实证明，不比较 opaque 用户 ID

### 背景

Applications 真实内部群验收中，Owner 明确 `@` 已安装机器人后仍无响应；同一 Bot 私聊正常，四个已发布 Bot 的
credential-bound Stream 均已连接，但 Core 没有收到任何群入站命令。回归入口要求
`chatbotUserId === atUsers[].dingtalkId`，该相等关系来自合成 fixture，不是 provider 合同。钉钉文档把
`chatbotUserId` 定义为“暂无使用场景，可忽略”的加密机器人 ID；官方仓库公开的真实 Stream callback 也证明
`chatbotUserId` 与 Bot mention 的 `dingtalkId` 可以使用不同编码。

### 决定

钉钉普通群 receiving Bot 由三项闭合事实证明：callback 来自该 Bot 自己的 `appKey/appSecret` Stream client；
callback 携带 `robotCode` 时必须匹配该 binding；`isInAtList=true`。`chatbotUserId` 与 `atUsers` 继续接受有界
shape 归一化，但不再参与 Bot target 相等判断，也不得从普通成员 identity 推导 Agent。多个 Rovai App 对同一
external message 的独立实际接收仍进入 3 秒观察窗并整条 fail closed；私聊和群 roster/Owner admission 不变。

本决定只取代 [V1.37-D11](#v1-37-d11) 的群目标 ID 相等假设；D11 的首次发布欢迎卡、品牌图标和身份文案继续有效。
当前字段与行为由 [DingTalk Channel v9](../../contracts/dingtalk-channel-v9.md)和
[钉钉渠道架构](../../architecture/dingtalk-channel.md)拥有。

### 后果与替代方案

- 单 Bot 的合法内部群 `@` 不再因为 provider opaque ID 编码不同而在进入 Core 前静默丢弃；未明确 @、`robotCode`
  不匹配和多个 receiving App 仍 fail closed。
- 拒绝继续比较 `chatbotUserId` 与 `atUsers`：provider 明确不承诺该用途，真实回调已经反证。
- 拒绝只看 `atUsers.length`：普通成员 mention 与 Bot target 不是同一命名空间。exact Stream binding 与
  `isInAtList` 已给出更窄且可验证的目标事实，不需要放宽 Owner、roster 或多 Bot 准入。

<a id="v1-37-d13"></a>
## V1.37-D13：钉钉群路由元数据不证明 Topic，群接入只承诺已安装应用 Bot 的内部群

### 背景

修正 opaque Bot ID 后的 Applications 真实复验取得了明确 transport 证据：同组织内部群通过“添加机器人”安装的 Bot
确实收到 Owner `@` callback，但在进入 Core 前被 `dingtalk_topic_not_supported` 拒绝。旧 gate 把 group callback 的
`openConvThreadId` 一律当成 Topic identity；首轮放开后，脱敏字段名诊断又证明同一普通内部群 callback 还携带
`openThreadId`。真实私聊与普通内部群会使用这些字段作为路由元数据。同期在钉钉 UI 普通群和外部群中，同名队员只是
普通成员身份；消息在客户端可见，但 Robot Stream 和 Core 均没有任何入站记录。

### 决定

`openConvThreadId / openThreadId` 按 Robot Stream 的不透明路由元数据处理，不参与 Topic 判定，也不进入 Core/模型。
归一化仍先按 `conversationType` 判定 p2p/group；group 只有出现明确 `threadId / topicId / topicKey` 才以
`dingtalk_topic_not_supported` fail closed。当前群能力只承诺同组织内部群中经“添加机器人”安装的企业内部应用 Bot；
普通成员形态的普通群/外部群不轮询、不冒用成员账号，也不伪造已收到。

当前字段和验证边界由 [DingTalk Channel v9](../../contracts/dingtalk-channel-v9.md)拥有，组件与 Feature Gate 由
[钉钉渠道架构](../../architecture/dingtalk-channel.md)拥有。

### 后果与替代方案

- 合法内部群 callback 不再因平台路由字段在 Core 前被误杀；明确 Topic 身份、Owner、roster、多 App 观察窗和附件 gate
  均不放宽。
- 钉钉 UI 普通群/外部群中的普通成员身份仍可被用户看到和 `@`，但没有 Robot Stream callback，因此不属于 Rovai 可接入
  的机器人群能力；这是外部平台投递边界，不以本地成功提示掩盖。
- 拒绝删除全部 Topic gate：明确 Topic 身份仍缺独立 roster/Camp mapping 证据。拒绝继续按字段名封禁
  `openConvThreadId / openThreadId`：真实普通消息已经反证。拒绝成员账号轮询旁路：它改变凭据、隐私、消息完整性和
  平台合规边界。

<a id="v1-37-d14"></a>
## V1.37-D14：钉钉通用卡片从权威卡片实例恢复动作，不要求用户模板

### 背景

Applications 中真实内部群项目卡已能显示，但点击项目或“刷新项目”没有反应。受控 callback 诊断证明 Card Stream
正常到达；钉钉内置通用 AI 模板把 `content.cardPrivateData.actionIds` 回传为模板内部节点 ID，而不是 Rovai 写入
`msgButtons[].id` 的业务 action。被点击按钮文本则稳定出现在 `content.cardPrivateData.params.text`。旧 parser 因此
无法解码 action 并静默返回。为绕过这一限制而要求普通用户先创建或选择卡片模板，不符合渠道的零配置使用边界。

### 决定

继续使用钉钉内置通用 AI 卡片和既有按钮，不增加用户创建、选择或发布模板的步骤，也不把项目选择改成依赖自定义模板
的下拉框。Main 从真实 callback 提取有界按钮文本、receiving App 与 `outTrackId`；Core 用 exact App/card instance
查询当前权威、已发送且版本一致的项目卡 delivery 或 execution console，并从冻结 payload 恢复唯一业务 action。
按钮文本只作查找提示；恢复后的项目选择、Quick Chat、刷新、最近输出和停止仍进入原有命令，由 Owner、外部卡片 ID、
nonce/version、AgentRun 与状态校验最终授权。旧 versioned action ID parser 保留为兼容路径。

当前 callback 与验证合同由 [DingTalk Channel v9](../../contracts/dingtalk-channel-v9.md)拥有，组件边界由
[钉钉渠道架构](../../architecture/dingtalk-channel.md)拥有。

### 后果与替代方案

- 已发送的通用项目卡在 Rovai 重启后仍可由数据库权威恢复动作，不依赖 Main 临时映射；卡片过期、App 不匹配、项目名
  重名或未知按钮均 fail closed。
- 拒绝信任按钮文本直接执行：文本可被伪造，且不含 Owner、版本或 Run 权威。拒绝只维护 Main 内存映射：重启后旧卡会
  再次失效。拒绝要求用户自建模板：这把渠道实现约束泄漏成每位用户的配置负担。

<a id="v1-37-d15"></a>
## V1.37-D15：钉钉卡片分离更新与撤回身份，执行卡和排队卡使用真实 Robot recall

### 背景

真实钉钉使用中，运行请求没有稳定呈现与飞书一致的执行中三入口卡；连续消息缺少可撤回的排队卡，上一张终态执行卡在
下一条 root request 入场后仍残留。旧 Host 只持有 AI Card 的 `outTrackId`，它适用于更新和 callback，却不是 Robot
撤回接口要求的 `processQueryKey`；因此实现只能把旧卡更新为“状态已结束”，无法完成产品要求的真实撤回。AI Card
deliver 响应同时返回独立 `carrierId`，两种身份不能互相猜测或复用。

### 决定

钉钉 AI Card 初次投递必须分别保留稳定 `outTrackId` 和响应 `carrierId`。Main 以
`externalUpdateMessageId` 结算 outTrack，以 `externalDeliveryMessageId` 结算 carrier；Core execution console 只把
outTrack 保存为当前可更新卡片，recall claim 另从已发送初次投递恢复 carrier。排队卡只保存 carrier，admission 后的
claim 必须返回 `updateMessageId=null` 与独立 `recallMessageId`。

运行中执行卡保留“显示最近输出 / 打开执行台 / 停止执行”，终态移除停止；终态卡在下一条 root request 入场前继续
可见。下一条 root 入场时，Host 按群聊/私聊调用 Robot recall 真正撤回上一张执行卡；连续请求真正进入 FIFO 时先发送
排队卡，入场时用同一 carrier 机制撤回。缺少 carrier、partial failure 或身份不匹配均 fail closed，不恢复结束占位
更新分支。飞书继续使用单一消息身份和既有召回，不引入钉钉 carrier 语义。

当前字段与行为由 [DingTalk Channel v10](../../contracts/dingtalk-channel-v10.md)、
[钉钉渠道架构](../../architecture/dingtalk-channel.md)和[渠道设置](../../ui/components/channel-settings.md)拥有。

### 后果与替代方案

- 执行更新/callback 与真实撤回各使用平台明确身份；Rovai 重试或进程内状态恢复不再把 carrier 当作 outTrack。
- FIFO 的“排队可见、入场撤回”与飞书保持同一产品时机；终态卡也不会永久留下结束占位。
- 拒绝继续用 update 模拟 recall：它不满足删除旧临时 surface 的产品语义。拒绝把 outTrack 猜作 processQueryKey：
  平台没有给出等价保证。未上线旧卡不增加字段兼容、批量修复或持久迁移。
