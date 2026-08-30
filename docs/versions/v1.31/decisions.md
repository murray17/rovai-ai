---
document_type: version-decisions
version: v1.31
lifecycle: current
last_updated: 2026-08-30
---

# v1.31 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前规范由链接的 Architecture、Contract、UI 与 Development 说明拥有。

<a id="v1-31-d01"></a>
## V1.31-D01：钉钉控制面由 Main 直接拥有 OAuth 与官方开发者 API

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

当前规范见[钉钉渠道架构](../../architecture/dingtalk-channel.md#developer-gateway-与-oauth)和
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

<a id="v1-31-d02"></a>
## V1.31-D02：Provider 专属身份与传输，复用同一个 Core admission/Outbox

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

<a id="v1-31-d03"></a>
## V1.31-D03：没有真实协议证据的会话能力默认关闭

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

<a id="v1-31-d04"></a>
## V1.31-D04：渠道秘密统一进入现有 SQLite，不依赖系统凭据库

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

该决定局部替代本文件 V1.31-D01 中 Token/Secret 不进入 Core、使用 OS safeStorage 的条款，以及 v1.30 飞书决定中相同的
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
