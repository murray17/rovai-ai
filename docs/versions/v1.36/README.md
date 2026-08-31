---
document_type: version-overview
version: v1.36
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-31
---

# Rovai-ai v1.36：钉钉队员 Bot 与 Camp 渠道

> 当前状态：飞书终态双层折叠与分页修复、主线外部附件快照已合入。钉钉已从 Web Session checkpoint 接通
> 普通企业应用创建、现代凭据、头像、Bot/权限、冻结版本配置/发布和 Stream readiness，当前合同为 v5，登录改用内置 QR Dialog。
> 用户授权的隔离测试组织已完成同一个应用的 Owner-only 1.0.0 发布；产品代码的只读恢复、头像上传和长连接验证通过。
> Owner 入站/Core Camp、群项目卡、卡片 callback 和 packaged 重启仍待验收，钉钉整体 NO-GO 不因隔离发布成功而关闭。
> `67010` 在新组织已证明存在描述字符校验原因；早期组织未捕获说明的拒绝不能追认根因。详见[研究记录](../../research/dingtalk-web-session-probe.md)。

前置版本：[v1.35 飞书队员 Bot 与 Camp 渠道](../v1.35/README.md)已按完成事实转为 historical。

## 版本目标

在不复制 Camp 业务链的前提下接入钉钉。每名在场 Rovai 队员可发布为一个独立内部应用机器人；已连接账号对应的
Owner 可在私聊或群聊显式 `@Bot` 后复用现有 Quick Chat、项目选择、原子 admission、Camp Membership、执行控制台
和永久输出。设置页以飞书既有信息层级增加 Provider Tab，同时保持各 Provider 的账号、Bot、秘密和诊断隔离。

## 交付范围

- Migration 122 增加 DingTalk account、Owner identity、publication intent、member Bot 与 per-App Owner identity，并建立
  provider-neutral Bot/Owner directory view；Migration 123 把旧 helper 发布模式无损迁移为 `direct_open_platform`，将 Data
  Contract 升到 `v1.36 / projection schema 77`；Migration 124 增加共享 `channel_credentials` 与
  `channel_developer_sessions`，切换到 `v1.37 / projection schema 78`；Migration 125 添加不可变终态 snapshot 并清理旧
  console view state，推进到 `v1.38 / projection schema 79`；本次合并以 126/127 接入 main Pending/Fast，
  128 汇合到 `v1.39 / projection schema 80`，保留两侧受支持旧库与业务数据；129 在此基础上删除重复 Evidence 索引，
  推进到 `v1.40 / projection schema 81`，唯一约束与所有业务行保持原样；130 接入 main Fast 生命周期修复，
  131 封闭当前 `v1.41 / projection schema 82`，精确 main119 receipt 映射至130，不重放已应用的修复；
- 账号连接在 Rovai QR Dialog 展示官方二维码；必要交互嵌入 Main 隔离的 sandbox 原生页面，不打开独立浏览器窗口。
  取消是静默 no-op，旧账号保留；以 corpId + staffId 校验身份，新身份与 Cookie Snapshot
  通过 Core 原子 `account.commitConnection` 一次写入 `rovai.sqlite`；失败只丢弃 staged jar，旧账号与 Session 不变；
- 不需要 Rovai OAuth Client、loopback、Device Flow 或 token broker。schema-2 Cookie 重启恢复、官方 SSO 隐藏续接；
  旧 schema-1 Profile 仅保留到显式重连成功，不伪造为 Cookie。断网、timeout、解析/保存失败保留会话，轮换后先 CAS 补存；
- 飞书/钉钉 Bot credential 与 Developer Session 明文存入既有 SQLite，由 Core/Main 独占；Renderer/日志/诊断不接收 raw
  payload。启动一次批量加载所有 published Bot，旧 `.bin` 不读取、不解密，系统安全存储与 Keychain 命名空间已移除；
- Main 调用钉钉固定 Console API，只允许封闭 operation/argument 集，并限制 redirect、response size、timeout 与取消。
  平台规定的 access_token query 只存在 Main HTTPS 请求内，完整 URL/Cookie/Secret 不进入 Renderer、日志或命令行；
  Session/Secret 仍可通过受限 Core API 写入 SQLite。包体不含 DWS binary/压缩载荷，
  不再需要版本/SHA、重签排除、物化目录、subprocess 生命周期和 stdout/stderr 解析；
- 每个 Agent 只有一个 immutable `unifiedAppId + appKey + robotCode`。发布状态机冻结远端身份后读取 credential、上传队员
  头像、先开启 bot 能力再配置 Stream robot、四项最小权限、冻结初始 draft 后配置 Owner-only 1.0.0 和审批，最后分别验证
  Stream 与 AI 卡片；创建前 durable fence 在中断后锁住自动重试，已知 App ID 的保存失败仍保留该 ID；其他失败只恢复原 App；
- `SELECT_APPROVER` 必须由 Owner 在 Rovai 发布 Dialog 中显式选择审批人；等待审批不是失败，也不伪造已发布；
- 每个 App 一个 `dingtalk-stream` Client，注册 Robot 与 Card callback topic；未验证的额外 business event code 不准入。
  connect() resolve 不等于在线，必须有界确认 connected；回调先 ACK，再进入异步 Main/Core 处理；
- 入站仅支持私聊和普通群。只有 Owner 私聊或 Owner 在群内显式 `@Bot` 才进入 Core；精确 `/new` 只支持私聊。话题字段
  一律 fail closed；非 Owner 群消息静默忽略，非 Owner 私聊提示按人/App 24 小时限流；
- 普通群首次消息在原群发送项目卡；项目绑定后不可换绑。第一条有效请求及后续根请求复用 provider-neutral
  ExternalPrincipal、ExternalQuote、ChannelTurnRequest、单根 FIFO 和统一原子 admission；
- 群 roster 从钉钉当前群机器人列表读取并与已发布 Rovai Bot 交集后同步到既有 Camp Membership；运行中 Run 不被修改；
- AI 卡片固定模板 `382e4302-551d-4880-bf29-a30acfab2e71.schema`、`callbackType=STREAM` 且禁止转发。执行控制台只展示
  Core 公开安全投影，不传 command stdout/stderr、工具 JSON 或推理；正式结果使用 Markdown；
- 飞书执行卡按 [Feishu Channel v7](../../contracts/feishu-channel-v7.md) 区分实时紧凑卡和终态完整卡；实时只直接显示当前正文、
  当前command及进度，总折叠保留10-command/20-block窗口并限制16KB/30-elements；终态在总折叠中混排公开文字与单条 command
  原生折叠；结果先脱敏再限 20 行/4KiB，timeline 按 15-command/50-element/24KB 分页。Core 同事务冻结内容与 sequence，
  翻页只读 sealed snapshot，由同步 response card 更新一次，返回第 1 页也保持外层展开；不再先 PATCH 后空 ACK。
  SDK 按 event ID 去重点击，Main 有界应答错误、成功无 Toast；非 callback 投递继续校验更新业务码。
  保留钉钉纯文本格式与下一轮 recall；
- 飞书永久正文采用无标题 Card 2.0，正文下方以空格分隔的原生 @ 显示实际 A2A 接收对象及 Owner attention；
  上方按真实 CampMessage 回复关系显示直接父消息的静态摘要，不把话题根消息当成每次回复；
  不携带 Renderer 的结构化 `@你` 展示缓存，不改变源消息或 Agent Context；超长正文完整拆分，通知仅在最后一张卡出现；
- 设置页保留飞书/钉钉 Tab、内置扫码 Dialog、队员发布、审批人选择、官方应用管理链接和 Provider-local 绑定诊断。

## 本轮存储优化

共享 Host 维护按 [Channel Host Maintenance v1](../../contracts/channel-host-maintenance-v1.md) 取消永久 poll 回执，
保留同事务的队列推进、真实 admission 审计和 Outbox lease 恢复。此次内部维护/物理索引优化不改变模型上下文或 UI，
不清理历史 event/Evidence、不执行 VACUUM，也不改变备份复制策略。属于局部可逆实现，无需新增 Version Decision。

## 渠道 Camp 命名

五种已支持渠道会话复用普通 Camp 的首消息自动命名。Core 原始标题不带渠道前缀；来源由现有绑定投影，
Renderer 在导航、搜索、顶部、最近会话和临时通知统一展示；手动重命名只编辑原始标题，闭合旧绑定仍保留来源。
本轮不重命名历史 Camp、不新增 Migration，不改变路由、权限或项目绑定。规范见
[Channel Camp Naming v1](../../contracts/channel-camp-naming-v1.md)、[Camp Open Projection v10](../../contracts/camp-open-projection-v10.md)
和 [Notification Episode v5](../../contracts/notification-episode-v5.md)。这是局部可逆的命名/展示收敛，无需新增 Version Decision；
不改变钉钉外部验收 NO-GO，不默认 push、打包或重启日常 App。

## 保守能力边界

- 同一钉钉消息直接 `@` 多个 Bot 的完整 canonical mapping 尚无真实租户证据；普通群只在 `isInAtList` 且 bounded canonical
  `atUsers` 恰好证明一个直接目标时进入 3 秒观察窗。缺失、歧义、多个条目或多个 receiving App 均整条 fail closed，不启动
  先到的部分 Agent。单 Bot 后续协作通过 Rovai Core A2A；不得把它宣称为多 Bot 直接 admission；
- 钉钉话题/独立话题群均未接入；任何 topic/thread identity 出现都拒绝，不降级为普通群；
- 入站附件只形成名称/媒体类型摘要。出站附件尚无已验证的 app-only 官方投递路径，当前明确失败为
  `dingtalk_attachment_delivery_not_supported`，不得伪造发送成功；
- 本地 `card_verified` 只证明官方模板实例创建 API 成功；卡片投递、callback 和翻页仍属于真实租户验收；
- 控制台内部接口不是公开稳定 API；未知 shape 不猜测。需要审批的组织、机器人已有配置更新、企业事件、真实 Core/群聊
  与 packaged 恢复仍需单独证据，不以当前免审测试组织的成功代替。

## 验收

仓库内门槛包括 Migration 122/123/124/125、状态机不可换绑、credential/intent 与 account/Session 原子提交、批量启动、create unknown、审批选择、Web Session/Console 参数边界、staged 账号切换、
Stream fast ACK、入站 normalize/topic 拒绝、Owner gate、统一 admission、roster、卡片参数、Provider UI、Rust/TypeScript、
文档和 Desktop 构建。外部门槛包括真实扫码、连接不创建应用、会话复用、应用审批/发布、头像、Stream、
私聊、群聊、项目卡 callback、执行卡翻页和重启恢复。外部证据完成前本版本保持 `in_progress`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 保留 main v1.33 Pending 与 v1.34 Fast；渠道历史/当前目录顺延至 v1.35/v1.36，v1.36 为唯一 current。迁入的历史决定只改元数据、ID 和链接；Data Contract 汇合另由新迁移拥有。 |
| Decisions | 已更新 | [v1.36 决定](decisions.md)保留既有 D01–D05，并由 D06 记录已安装渠道 ledger 与 main schema 的无损汇合取舍。 |
| Contracts | 已更新 | [DingTalk Channel v5](../../contracts/dingtalk-channel-v5.md)继承 v4 Web Session、Cookie schema 2、封闭 Console 发布与中断恢复，增加内置官方扫码、原生交互页和静默取消；[Channel Storage v2](../../contracts/channel-storage-v2.md)继续拥有 SQLite 原子事务、飞书三态检查与钉钉 completed 同应用凭据恢复；[Feishu Channel v7](../../contracts/feishu-channel-v7.md)保留 v6 双层终态/同步分页，增加实时滚动折叠预算和共享安全 publicResult，不新增 Migration；旧合同冻结为历史入口。 |
| Architecture | 已更新 | 钉钉/飞书架构保留渠道范围；[Availability-first Runtime](../../architecture/availability-first-runtime.md#migration-switch) 与 [Channel/Main Schema Join v2](../../contracts/channel-main-schema-join-v2.md)拥有旧主线/渠道精确汇合及原位逐事务升级。 |
| UI | 已更新 | [渠道设置](../../ui/components/channel-settings.md)保留 Provider Tab、钉钉官方登录/审批/发布与 Provider-local 诊断合同，钉钉说明同步 Web Session；飞书终态文字/command、结果框与客户端本地折叠不变。 |
| Runtime Activity | 确认无需更新 | 钉钉继续消费既有公开 AgentRun Evidence 和 CampMessage，不新增 Runtime activity kind 或 Adapter mapping。 |
| Runtime compatibility | 确认无需更新 | 不改变 Product Runtime command、Session、模型、权限、平台准入或实测支持矩阵。 |
| Documentation routing | 已更新 | 文档总入口、Architecture、Contracts、Decisions、UI、Development 与版本索引加入钉钉任务入口。 |
| Root README | 确认无需更新 | 钉钉是可选外部渠道，不改变 Rovai-ai 常青定位或 Runtime 支持声明；外部验收未完成也不应写入根能力宣称。 |

## 版本编号合并说明

2026-08-30 合并 `main@27c6b16f` 时，主线已使用 v1.31 保存其他功能。渠道分支
`7eaa7b97` 中原 v1.31 的记录迁至 v1.33，仅调整版本元数据、决定 ID/锚点和链接；
原取舍、确认内容、Data Contract 编号与验收结论保持不变，原始记录可从该 Git revision 追溯。

合入范围还包括主线 [v1.30 文件预览](../v1.30/README.md)与 [v1.31 Availability-first Runtime](../v1.31/README.md)。
渠道 Host 在 Core authority ready 后按 generation 启动，失去 authority 后停止，恢复后重连；
原渠道 Migration 117–124 与旧飞书 marker collision 恢复接入主线的票据准入和副本迁移，不降级现有数据合同。

### 本次主线合并：2026-08-30

合并 `main@4e796bde` 时，保留主线 [v1.32 外部附件静默快照](../v1.32/README.md)的编号和原始结论，
按已有实施事实冻结为 historical。渠道分支 `d87e88b6` 中原 v1.32 飞书记录顺延到 v1.33，原 v1.33 钉钉与共享
渠道记录顺延到 v1.34；只调整版本元数据、决定 ID/锚点和路由，历史决定正文与模型确认 revision 不变。
当前实现同时保留主线 Camp Detail Popover、启动局部 loading、Composer 输入和附件快照改动。
主线的 Camp Attachment v7、Camp Message Send v14 和 Built-in Tool Transport v21 继续拥有附件语义，
渠道的 ContextManifest Evidence v22、Feishu Channel v5 与 SQLite storage 边界不回退。

### 本次主线合并：2026-08-31

合并 `main@91ecd6d4`，保留 v1.33 Pending 与 v1.34 Fast 的编号、既有决定和验收结论；本分支原 v1.33/v1.34
渠道记录顺延到 v1.35/v1.36，仅变更元数据、ID/锚点和链接。迁移的新规范为
[Channel/Main Schema Join v1](../../contracts/channel-main-schema-join-v1.md)，不覆盖已安装的渠道 migration ledger。
两侧旧库经过真实 ticket/copy/switch 后保留原数据；新的 schema/marker 拒绝矩阵和完整门禁见实施计划。

### 普通升级轻量化：2026-08-31

上述 copy/switch 为主线合并当时的实施记录；当前执行策略已由 [V1.36-D07](decisions.md#v1-36-d07) 与
[Desktop Runtime Availability v2](../../contracts/desktop-runtime-availability-v2.md)替代。严格确认 authority 后，
普通升级直接在票据的精确原库运行逐版本事务，不复制整库、创建新 manifest/backup、默认全库检查或替换文件。
每步 DDL/DML 与 receipt 原子提交，中断后保留已完成步骤并继续；旧 manifest 兼容恢复仍在。

保留 126/127 的精确映射和 128 的 `v1.39/schema 80` 历史封口；当次改动以索引优化的129/`v1.40/schema 81`为目标，
未额外新增 migration。关键 schema metadata 和局部外键在各自边界校验，原库消失/替换时不允许自动或手动重试建空库。
启动瞬时重试独立于 crash budget，产品保持 400ms 延迟与原布局，统一“正在打开会话”及安全的最终失败恢复入口。
117–125 与可达旧链审计、隔离回归和实际验证结果见[实施计划](implementation-plan.md#普通升级原位事务与启动反馈)。
本次不推送、不打包、不安装或重启日常 App，不写日常数据库，也不改变钉钉既有 NO-GO 外部验收边界。

### 再次合入主线并保留数据库协议：2026-08-31

合入 `main@48a9140f` 的Fast偏好修复、输入队列/连续输入、执行头像栏、紧凑审批、模型目录与文件链接改进。
数据库执行边界继续采用已确认的原位逐事务协议，不恢复普通Snapshot Switch，不创建空authority。
为避免新main119覆盖渠道119，将其语义追加为130；精确main `v1.34/schema 73` 来源的119直接映射130并保留时间戳。
131统一封闭当前合同，128/129的历史含义不变。只扩展已有汇合规则，没有新增planner或策略注册表，亦无需新增决定。
本次安装按用户要求提升至 `/Applications`；隔离门禁与安装结果另记于实施计划，不将磁盘更新视为当前进程热升级。

### 飞书分页回退修正

用户在原生飞书客户端复现“第 2 页点下一页，短暂显示第 3 页后退回第 2 页”；绕过 callback 直接更新同卡可稳定显示
目标页。实现据官方即时回调协议切换为 [Feishu Channel v6](../../contracts/feishu-channel-v6.md) 的单一 response card，
删除分页中的独立 PATCH，并覆盖真实 SDK WebSocket 应答编码、多页往返、Owner 拒绝及超时。
这是可逆的渠道协议修正，不改跨子系统权威或引入高迁移成本，因此无需新增 Version Decision；历史合同和决定不改写。
新代码的实际飞书客户端验收尚未完成，不能以本地通过或应答准备日志代替。

### 飞书永久正文卡选择

用户对比同一话题中的卡片/普通消息预览后选择卡片，并要求多个 @ 之间仅空格分隔；随后确认一起增加真实回复关系展示。
现有 `reply_to_camp_message_id` 已能区分 Owner 根消息与后续 A2A 父消息，仅新增出站摘要投影，不新增数据库字段。飞书专用出站投影按
[Feishu Channel v6](../../contracts/feishu-channel-v6.md#4-永久公开正文与接收对象) 和[渠道 UI](../../ui/components/channel-settings.md#飞书永久正文卡)
实现；不修改 A2A dispatch、Owner 身份或模型上下文，不新增 Version Decision。既有卡片原生提及预览已由真实客户端解析，
本轮正式链路仍须在用户授权安装后验收，不把预览当作 packaged 交付。
