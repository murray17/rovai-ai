---
document_type: version-decisions
version: v1.36
lifecycle: current
last_updated: 2026-08-31
---

# v1.36 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前规范由链接的 Architecture、Contract、UI 与 Development 说明拥有。

<a id="v1-36-d01"></a>
## V1.36-D01：钉钉控制面由 Main 直接拥有 OAuth 与官方开发者 API

### 背景

钉钉队员应用的创建、Robot 配置、权限、版本和审批需要开发者控制面。早期实现把 DWS 当作固定 helper 以隔离 Shell 与
全局 profile；源码复核后确认它在本场景只是钉钉 OAuth、官方 `op-app` developer service 与本地 token persistence 的薄封装，
Stream 本来也由 Rovai Main 直接连接。继续随包携带第三方 binary 只会增加版本/SHA、重签、物化目录和子进程协议边界，
并不增加钉钉平台安全能力。

### 决定

Electron Main 直接实现浏览器 loopback/设备 OAuth、加密多 profile token store、官方 developer service 调用和
`dingtalk-stream`。Developer Gateway 固定钉钉 endpoint、operation/argument、header、响应大小、timeout 与取消边界；Token 与
Secret 只存在 Main 内存、OS safeStorage 和发往固定钉钉 endpoint 的 HTTPS credential 字段，不进 URL、Core、Renderer、
日志或命令行。创建和 mutation outcome 无法证明时继续 fail closed。安装包不含或启动 DWS，也不保留 DWS version/SHA、
重签排除、物化和 stdout/stderr 解析。生产包在 public-client/device-flow 或 token broker 明确前保持 NO-GO；不得复用第三方
工具内置 Client ID，也不得回退为人工粘贴 AppSecret。

当前规范见[钉钉渠道架构](../../architecture/dingtalk-channel.md#developer-web-session-与控制台-api)和
[DingTalk Channel v2](../../contracts/dingtalk-channel-v2.md)。

### 后果

- OAuth 与 developer service 协议变化只修改 Main Adapter，不改变 Core 渠道合同；
- 安装、签名和运行时不再引入第三方本地可执行信任主体；
- 缺少显式 Rovai OAuth Client 是可见配置错误，不是假连接或降级路径。

### 被拒绝方案

- **继续随包携带固定 DWS：** 没有平台要求，且增加 SHA、签名、物化与 subprocess 复杂度；
- **调用用户 PATH 中的 DWS：** 版本、profile 和命令表不可证明；
- **Renderer 执行 OAuth/API 或读取 credential：** 扩大 Token、Secret 和控制面注入边界；
- **复用第三方工具内置 OAuth Client：** 所有权、配额和生产授权对象不属于 Rovai；
- **复制开放平台网页 console 私有 HTTP：** 形成高漂移协议面；当前直接使用官方 developer service，而非网页抓包接口。

<a id="v1-36-d02"></a>
## V1.36-D02：Provider 专属身份与传输，复用同一个 Core admission/Outbox

### 背景

钉钉的 `corpId/userId/appKey/robotCode`、Stream 与卡片协议不同于飞书，但项目冻结、ExternalPrincipal、根请求 FIFO、
Camp Membership、原子 CampMessage/Turn/Run 创建和可靠输出语义相同。复制一套钉钉 Camp 执行链会让两个渠道在安全与恢复
边界上逐渐分叉。

### 决定

账号、发布、credential、入站规范化、远端 roster、Stream 和 Card 留在 DingTalk Host；Migration 122 只增加钉钉身份表，
再用 provider-neutral directory 把已发布 Bot 和 Owner identity 接入现有渠道聚合、PendingCampBinding、ChannelTurnRequest、
统一原子 admission、Camp Membership 与 ChannelDelivery。所有共享对象都携带 `provider=dingtalk`，但不创建第二套
CampMessage、CampTurn 或 AgentRun 写入路径。

当前规范见[钉钉渠道架构](../../architecture/dingtalk-channel.md#core-复用与入站准入)和
[DingTalk Channel v2](../../contracts/dingtalk-channel-v2.md#5-core-入站与-camp-语义)。

### 后果

- 两个 Provider 可以独立掉线、发布和恢复，但共享项目与执行正确性；
- 钉钉 Host 不能直接写 CampMessage、CampTurn、AgentRun 或 membership 表；
- 共享 Core 语义变更必须同时验证飞书回归和钉钉 provider isolation。

### 被拒绝方案

- **复制 Feishu Core 表和 admission：** 会形成第二套事务、FIFO 和恢复语义；
- **把钉钉 ID 强塞进 Feishu 表：** 混淆不同 identity namespace 与发布状态；
- **Main 收到消息后直接启动 Runtime：** 绕过 Owner、项目、membership 和原子 admission 门禁。

<a id="v1-36-d03"></a>
## V1.36-D03：没有真实协议证据的会话能力默认关闭

### 背景

方案目标包含多 Bot、话题、附件和 AI 卡片，但仓库自动化不能证明钉钉真实客户端会提供完整 canonical mention、话题身份、
app-only 附件投递或 callback 行为。把普通群 fallback 当成话题、把多 observation 猜成完整目标或在附件 API 不明时报告成功，
都会在 Owner 不知情时改变项目与执行范围。

### 决定

当前只准入 Owner 私聊和普通群显式 `@`。topic/thread 字段一律拒绝；同一消息在 3 秒观察窗内到达多个 receiving App 时
整条 fail closed，不启动先到的部分 Agent，其他协作走 Core A2A；出站附件明确失败；卡片能力在真实投递/callback 验收
完成前不提升为生产通过。后续解除任何 gate 必须先取得官方协议与真实租户证据，再更新当前 Contract、测试和版本验收。

当前规范见[钉钉渠道架构](../../architecture/dingtalk-channel.md#当前-feature-gate)和
[DingTalk Channel v2](../../contracts/dingtalk-channel-v2.md#8-feature-gate-与错误)。

### 后果

- 未支持场景不会静默落入错误 Camp 或伪造 delivery success；
- 当前首轮只能有一个钉钉直接目标，但 Agent 仍可通过 Core A2A 使用 Camp 协作者；
- 能力扩张是独立、可验收的合同变化，而不是 parser 的宽松兼容。

### 被拒绝方案

- **topic 缺字段时按普通群处理：** 可能把多个 Topic 合并到一个 Camp；
- **收到几个 App callback 就猜完整多 Bot 集：** 无法证明漏掉的 observation；
- **附件转成路径或 Markdown 链接并标记成功：** 既可能泄露本机路径，也没有远端交付证据；
- **以卡片 create API 代替 callback 验收：** 只证明实例存在，不能证明用户交互闭环。

<a id="v1-36-d04"></a>
## V1.36-D04：渠道秘密统一进入现有 SQLite，不依赖系统凭据库

### 背景

飞书 App Secret/Cookie 与钉钉 App Secret/OAuth Profile 原先由 Main 分别经 Electron `safeStorage` 写入 `.bin`。这形成了
SQLite 业务状态与外部 credential 文件的双权威：账号、publication intent 或 Bot row 可以提交而对应文件失败，启动还要逐
Bot 访问系统凭据库。Keychain/DPAPI/Secret Service 的可用性、应用名 namespace、签名身份和授权 UI 又让开发、隔离验收与
跨平台恢复产生额外状态，但并未消除本机 Owner 对应用数据目录的信任。

### 决定

Migration 124 在既有 `rovai.sqlite` 增加 `channel_credentials` 与 `channel_developer_sessions`，明文保存渠道 Secret、Token 和
Cookie。Core/Main 是唯一读取边界；Renderer、日志、诊断和 Agent Context 继续禁止 raw payload。账号与 Session、credential
与 publication intent 分别用单一 Core 事务提交；Session refresh 使用 revision CAS；启动用一次 JOIN 批量加载所有 published
Bot。旧 `.bin` clean break：不读取、不解密、不迁移，只允许 Main 严格名称删除。Electron 不再调用 `safeStorage`，隔离实例
只依赖不同 `userData`/SQLite，应用名保持 `APP_NAME`。

该决定局部替代本文件 V1.36-D01 中 Token/Secret 不进入 Core、使用 OS safeStorage 的条款，以及 v1.30 飞书决定中相同的
持久化条款；OAuth/Developer API 固定端点、Renderer 隔离、网络与日志安全边界不变。当前规范见
[Channel Storage v1](../../contracts/channel-storage-v1.md)、[飞书渠道架构](../../architecture/feishu-channel.md)和
[钉钉渠道架构](../../architecture/dingtalk-channel.md)。

### 后果

- 备份或取得 `rovai.sqlite` 即可读取渠道秘密，因此数据目录本身必须按秘密材料保护；Rovai 不再宣称 at-rest OS encryption；
- Core 可以在同一事务维护 credential/session 与业务状态，消除文件/数据库半提交，并用一次查询恢复全部 Bot；
- 开发、打包和隔离验收不再弹出系统凭据库授权，也不再受应用名或签名 namespace 影响；
- Provider Host 仍只能获得自身必要 payload，秘密不得越过 Main/Core 或进入公开错误。

### 被拒绝方案

- **继续 OS safeStorage + `.bin`：** 保留双权威、逐 Bot 启动访问、平台授权 UI 和签名 namespace；
- **单独 `channel.sqlite`：** 引入第二个事务与备份边界，不能与 account/publication 状态原子提交；
- **自动解密迁移旧文件：** 启动仍需访问旧系统凭据库，并把 clean break 变成跨平台兼容矩阵；
- **把 Secret 放 Renderer 或配置文件：** 扩大页面、日志、IPC 与注入攻击面；
- **只把 credential 放 SQLite、Session 留 safeStorage：** 仍保留两套恢复和账号切换半状态。

<a id="v1-36-d05"></a>
## V1.36-D05：钉钉开发者控制面改用 Main-owned Web Session

### 背景与决定

预注册 Rovai OAuth Client 的分发和 token broker 会引入额外授权主体与运营边界；普通客户端无法仅凭自己的一次开发者
扫码直接完成既有控制面操作。用户要求沿用飞书式的 Main-owned Developer Session，并授权在其测试组织验证。
官方控制台的 Cookie/SSO 已在隔离 Electron 中完成身份、重启恢复、同一企业应用创建、配置和发布验证。

因此用 Main 隔离 Web Session 与封闭 Console Gateway 替代 Rovai OAuth Client/loopback/refresh-token 链路，
不借用平台 Client Secret 或 Chrome Profile。Session 与 Bot credential 仍由现有 SQLite/Core 原子事务持久化；
Bot OpenAPI/Stream 使用独立 App 凭据，不使用开发者 Cookie。取消、临时网络和存储失败保留旧 Session；
只有明确的登录失效才让用户重连。

这一决定替代 D01 的 OAuth Client、developer service 与“拒绝网页 console”条款，不改变其删除 DWS 的决定，
也不改变 D02 的统一 admission、D03 的保守 feature gate 或 D04 的 SQLite 秘密边界。
当前规范见 [DingTalk Channel v4](../../contracts/dingtalk-channel-v4.md)与
[钉钉渠道架构](../../architecture/dingtalk-channel.md#developer-web-session-与控制台-api)。

### 取舍与后果

- 接受官方网页内部接口的漂移维护成本，换取无需 Rovai OAuth Client 配置的本地开发者登录和应用管理；
  只能准入有官方源码与实测依据的封闭操作，未知 shape 保留原应用并停止，不能猜测或自动重新创建。
- 平台规定的 access_token query 只存在固定 HTTPS 请求内，不能进入日志或 Renderer；Cookie 有效期由平台拥有，
  不承诺固定天数，也不模拟或延长平台会话。
- 旧 OAuth Profile 无法无损转成 Cookie，保留旧记录直到显式成功重连；已发布 App 与 Bot Secret 不换绑。
- 不选继续维护 OAuth Client/token broker：增加与当前纯本地产品不一致的授权和部署依赖。
- 不选复用第三方 Client Secret、用户浏览器 Profile 或网页点击脚本：扩大秘密/自动化边界，不能提供可靠的身份冻结和读回。
- 隔离发布通过不等于生产 Camp/群聊/卡片 callback 全链路通过；验收状态仍独立记录在本版本实施计划。

<a id="v1-36-d06"></a>
## V1.36-D06：保留已安装渠道迁移顺序，精确汇合 main 的 Pending/Fast

### 背景与决定

合并 `main@91ecd6d4` 时，渠道安装版已使用 117–125 保存开发者会话、Owner 绑定、执行卡、钉钉与凭据；
main 独立使用 117/118 保存 Pending/Fast。直接选取任一侧的编号会把另一侧旧库误认成已迁移，或要求清空用户数据。

保留已安装渠道编号；在 staging copy 内仅对具有精确 marker、完整 ledger 与已知 schema 的旧 main 库，将其
117/118 receipt 映射到追加的 126/127，原时间戳与业务行不变。128 在两侧迁移完整后统一 current marker。
当前规范由 [Channel/Main Schema Join v1](../../contracts/channel-main-schema-join-v1.md) 与
[Migration switch](../../architecture/availability-first-runtime.md#migration-switch) 拥有。

### 取舍与后果

- 不选择重新排序已安装渠道迁移或清空 SQLite：会改变已部署数据的含义，损失凭据、Bot 绑定或历史状态。
- 不选择仅按 main 的版本字符串跳过重复创建：同号不同 schema 必须被精确区分，部分或未知形态应 fail closed。
- 接受两个旧 main schema 的显式兼容成本；常规升级仍复用同一个 admission/copy/switch owner，不增加运行时双写。
- 保留 legacy receipt 的原 applied_at，并允许映射后的 126/127 先于低编号渠道 checkpoint；只有完整 128 才可作为 current。

<a id="v1-36-d07"></a>
## V1.36-D07：严格准入后原位事务升级，快照仅保留旧中断恢复

### 背景与决定

默认 Snapshot Switch 为每个旧合同复制整库、迁移副本、再保存原 main/sidecar 并切换。即使只是 Pending/Fast
additive schema 或 contract seal，时间、磁盘占用和故障面仍随历史数据库体积增长。逐步迁移已经具备 receipt，
不需要为了正常 schema 升级再建立第二份完整权威状态。

保留租约、双 namespace 排歧、exact ticket、source contract/receipt/schema fingerprint 与 identity 复核；确认后只在
原 authority 使用既有逐版本 IMMEDIATE 事务迁移。每步 schema/data/marker/receipt 同时提交，失败回滚本步、下次从
已提交 receipt 继续。main 117/118 的精确映射不变，只从 staging 移到原库事务。不引入 planner、strategy 或 descriptor registry。

停止为普通升级创建 snapshot/manifest/backup、替换文件或执行全库完整性扫描。关键 schema 使用 metadata 检查，
关闭外键重建的步骤在提交前检查显式受影响表。完整诊断、用户备份、损坏恢复与一般历史投影补算各自独立；既有历史
manifest 仍按原对象身份恢复。迁移后重验同一 main 并重新 admission，不允许失败或重试时初始化空库。

仅明确的数据库启动瞬时错误使用独立 250/750/1500ms 重试，不占用 crash budget；确定性错误保留壳层恢复入口。
用户仍使用原来的 400ms 内容区反馈，统一“正在打开会话”；最终失败为“暂时无法打开会话”，技术细节留在诊断。

该决定替代 V1.31-D03 与本文件 D06 的默认副本执行策略，不改变其权威准入、不覆盖未知对象或 receipt 汇合语义。
当前规范为 [Desktop Runtime Availability v2](../../contracts/desktop-runtime-availability-v2.md)、
[Channel/Main Schema Join v2](../../contracts/channel-main-schema-join-v2.md)与
[Availability-first Runtime](../../architecture/availability-first-runtime.md#migration-switch)。

### 取舍与后果

- 接受逐版本提交后“已完成部分升级”的可恢复状态，不承诺失败时整个文件仍等同于升级前；原权威位置和业务数据仍受保护。
- 不选择所有步骤包进一个大事务：失败会重做前面全部工作，增加锁持有时间；receipt 已提供明确的继续边界。
- 不选择多级 migration planner 或常态保留 copy fallback：增加长期策略组合，并掩盖未审计迁移的事务边界问题。
- 不删除旧 manifest 恢复：已安装版本可能在切换中被中断，不能因默认路径轻量化使这些现场失去恢复能力。
- 不把 SQL 错误统一当作 transient 或 corruption：只重试明确锁/短暂 I/O；未知合同、换库和不匹配 schema 必须拒绝。
- 已审计 117–125 与可达旧链；72/90/96/97 的事务外 DDL 修回本步骤事务，局部外键检查移到提交前。
  验证归属与尚未完成的外部验收仍以本版本实施计划为准，不由本决定推断完成。

## 版本编号合并说明

2026-08-30 合并 `main@27c6b16f` 时，主线已使用 v1.31 保存其他功能。渠道分支
`7eaa7b97` 中原 v1.31 的记录迁至 v1.33，仅调整版本元数据、决定 ID/锚点和链接；
原取舍、确认内容、Data Contract 编号与验收结论保持不变，原始记录可从该 Git revision 追溯。
