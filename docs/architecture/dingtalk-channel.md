---
document_type: architecture
architecture: dingtalk-channel
authority: dingtalk-channel-component-and-authority-boundaries
status: accepted
last_updated: 2026-08-30
---

# 钉钉渠道架构

字段、状态和恢复合同见 [DingTalk Channel v4](../contracts/dingtalk-channel-v4.md)，credential 与 Developer Session 持久化见
[Channel Storage v2](../contracts/channel-storage-v2.md)，共享 Camp admission、membership 与
模型输入分别继续由 [Feishu Channel v2](../contracts/feishu-channel-v2.md)中已经 provider-neutral 的渠道核心、
[Camp Membership v1](../contracts/camp-membership-v1.md)和
[ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)拥有。取舍理由见
[v1.36 决策记录](../versions/v1.36/decisions.md)。

## 组件与权威

```text
Renderer 渠道设置
  └─ typed Preload API
       └─ Electron Main / ChannelSettingsCoordinator
          ├─ Feishu Channel Host（既有）
          └─ DingTalk Channel Host
             ├─ Developer Web Session / staged Cookie jar / 官方 SSO
             ├─ closed Console API Gateway / PNG multipart
             ├─ Member Bot Provisioner
             ├─ SQLite Channel Store Client：Session/credential 原子提交与批量读取
             ├─ 每 App dingtalk-stream Client
             ├─ App-only Open API：roster、Markdown、AI 卡片
             ├─ inbound/card normalization
             └─ durable ChannelDelivery worker
                              │
                              ▼
                         Rust Core
             ├─ provider-specific account/session/credential/publication/Bot identity
             ├─ provider-neutral Bot/Owner directory
             ├─ ExternalPrincipal / ExternalQuote
             ├─ conversation binding / PendingCampBinding
             ├─ ChannelTurnRequest / single-root FIFO
             ├─ unified atomic Camp admission / membership
             └─ execution console / ChannelDelivery outbox
```

Renderer 只呈现 Provider snapshot 和显式 Owner 动作。它不接触控制台 Cookie/Token、AppSecret、Session 原文、控制面输出、
transport conversation 或 pending aggregate。Main 拥有外部网络和运行期秘密；Core 在 `rovai.sqlite` 中拥有明文持久
Session/credential 以及业务 identity、项目/Camp、admission、
membership 与 Outbox。DingTalk Host 不直接创建 CampMessage、CampTurn 或 AgentRun。

## Developer Web Session 与控制台 API

Main 在隔离 Electron 窗口打开官方开放平台，用户扫码/确认并选择组织；`/baseInfo` 的 `corpId + staffId` 是 Owner 身份。
Rovai 不需要预注册 OAuth Client、loopback、设备授权、token broker、第三方 Client Secret 或用户 Chrome Profile。
平台 SSO 的 OAuth 页面只是平台自身的登录实现，不是 Rovai 的另一条授权链。

`ElectronDingTalkDeveloperSessionService` 拥有非 persist Cookie jar、staged 账号切换、身份串行校验和 SQLite revision/CAS。
登录/SSO 后将经过允许字段/域名校验的 Snapshot 恢复到 API-only jar，并核验相同身份后接管。Cookie schema 2 保存
session、host-only 与原始安全/过期属性，不延长有效期。旧 schema-1 OAuth Profile 保留到显式重连成功后原子替换，
不能伪造为 Cookie，也不再参与 OAuth 请求。

`DingTalkDeveloperGateway` 只允许 reviewed operation/argument，经固定 `open-dev.dingtalk.com` 的内部 console API
创建和配置应用。Cookie 中的 access_token 按官方网页协议解码一次、编码一次进入 query；CSRF 与 Cookie 仍在同一个
Main jar 内。所有完整 URL、Cookie、Secret、response body 与远端错误文本均不得进入公开错误、日志、Renderer 或命令行。
头像为 Main 受管 PNG，使用封闭 multipart 上传，不把文件路径/Secret 传入 Renderer。
未知 wire shape、redirect、超长响应、timeout 与取消均有明确边界；不自动重放 mutation，不回退 OAuth/MCP。
控制台内部协议存在漂移风险，不能把它表述为公开 OpenAPI 稳定承诺。Gateway 仍是 Main Adapter，不是 Core domain API。

Desktop 包只携带 Rovai 自己的 Core 与 CLI sidecar，不含第三方钉钉可执行文件、压缩载荷、许可证资源、版本/SHA allowlist、
重签排除或子进程协议。macOS 打包门禁会拒绝出现 `dws`、`dws.gz` 或 `dws.exe`；Windows extraResources 同样只列 Rovai
sidecar。Stream 从始至终由 Main 内的 `dingtalk-stream` SDK 直接连接，不经过本地转发进程。

切换账号时旧 Session 保持有效：Main 在独立 staged jar 完成新登录并读取完整
`corpId/userId/userName/corpName`，再调用 `channels.dingtalk.account.commitConnection`，由单一 SQLite 事务同时替换当前
Developer Session 与 connected account。Core 失败时只丢弃 staged jar，旧 SQLite/内存 Session 均不变。Cookie 轮换
通过 Session revision CAS 保存；失败的轮换结果暂存在 Main，下次先回读 revision 并补存，不能覆盖新账号或复活断开状态。
启动恢复同一 Cookie Snapshot；明确登录拒绝时先允许官方 SSO 在隐藏窗口续接，不承诺固定有效天数，也没有 Rovai refresh token。
断网、timeout、未知响应和 SQLite 失败保留 Session；本地加载失败必须可重试，不缓存成未登录。
只有明确没有 Session、SSO 无法续接的登录失效或身份漂移时才按 account/version expire。断开/明确过期仍在 Core 同一事务
删除当前 Provider Session 并更新账号状态，不关闭、迁移或删除已发布 Bot。显式连接/断开或 Host stop 使旧启动检查失效。

## 队员应用发布

一个 Agent 对应一个 immutable 内部应用机器人：

```text
agentId
  ↔ publicationIntentId
  ↔ unifiedAppId
  ↔ appKey
  ↔ robotCode
  ↔ credentialRef
```

发布前复核 Web Session 与 intent 冻结的 `corpId + userId digest`。只创建普通 `appType:2` 企业内部应用，不套用 AI 模板。
创建前提交 durable account_verified fence，重启时该状态缺失 App ID 就停止自动创建；取得 `unifiedAppId` 后，必须在读取
Secret 或任何后续 mutation 前由 Core durable freeze。冻结回执失败仍保留已知 App ID，失败事务携带该 ID，不重新创建。
后续读取现代 App credential、经 console 上传队员头像、先开启 bot 能力再配置 Stream Robot、加入
`qyapi_robot_sendmsg`、`qyapi_chat_manage`、`Card.Instance.Write`、`Card.Streaming.Write`，再冻结初始 draft ID、提交
Owner-only 可见范围的 1.0.0、按远端 approval mode 显式选择审批人或发布、回读冻结版本 release status，再启动 Stream
并创建官方 AI 卡片模板实例。每一步推进持久 publication intent，重启或失败只能从同一 App 恢复。
App credential 与 `credentials_read` 必须通过 `channels.dingtalk.publicationIntent.storeCredential` 在同一 SQLite 事务提交；
不能先写 Main 文件再单独推进 intent，也不能在后续失败时换 App。

completed intent 不替代本地 credential 可用性检查。重试先读取 exact ref；缺失时只以原账号和原 App 的 completed resume
路径回读 Secret/Robot/版本，由 Core 核对 exact published binding 后补写 SQLite。该事务保持 completed 和发布水位，
不重开发布、不改变 Bot identity；恢复失败后仍可重试同一 App，不创建应用或新版本。

Gateway 规范化 console 的数字模式/状态、grouped scopes 和无 data 的成功响应，不在上层猜测字段。
没有额外 business event code 时只使用 SDK Robot/Card topics；未验证事件订阅保持关闭。
`DING_BPMS + requiredApproval:false` 映射 `NO_APPROVAL` 可直接发布；`SELECT_APPROVER` 必须把远端候选人投影到 Rovai Dialog，由 Owner 明确选择后继续；`AUTO`
按远端事实处理。提交审批后若状态仍为 audit/review，intent 停在 `awaiting_approval`，不是失败。publish 请求超时或返回
错误时先读冻结 version status；已 release 就收敛成功，不能重复发布。App current version 自动进入新 INIT draft 不等于发布失败。
不自动确认敏感权限，不扩大可见范围。只有 create outcome unknown 且没有任何可信 App ID
进入永久自动重建锁；一旦 identity 已冻结，所有失败都只能恢复原 App。

## Stream、卡片与输出

每个 published App 独立建立一个 `dingtalk-stream` Client，只订阅 SDK 的 Robot/Card topic。callback handler 先以当前
message ID 返回成功 ACK，再把 JSON parse、identity validation 和 Core admission 放入 microtask；慢业务不能占用 ACK
窗口。SDK connect() 即使失败也可能 resolve，readiness 必须检查 connected，不能依赖 registered；并发启动共享同一次
有界连接检查。连接失败/超时会从 registry 删除 client 并断开，stop/替换后的迟到 callback 不进 Core，其他 App 不受影响；App credential 在启动时经共享批量查询从 SQLite 进入
Main 内存，运行期不逐消息读取。

Open API 只接受 `appKey/appSecret` 换取短期 access token。群 roster、群/私聊 Markdown 和卡片操作都使用
固定 API origin 与有界 timeout。AI 卡固定使用模板 `382e4302-551d-4880-bf29-a30acfab2e71.schema`、
`callbackType=STREAM`、`supportForward=false`。项目卡和执行卡 callback 仍须由 Core 校验 exact App、Owner userId、
outTrackId、nonce/version 或 AgentRun snapshot sequence；卡片 payload 不能直接改变项目或执行状态。

执行控制台消费 Core 的公开安全 projection。Main 只发送 narration、safe public command、公开文件变化和已提交输出；
command stdin/stdout/stderr、工具 input/output JSON、patch body 与推理不进入钉钉。运行态可 streaming update，sealed 终态
只通过授权的无状态页码更新原卡。正式 Agent 输出是新的 Markdown 消息，网络失败只结算 Outbox，不回滚 Core 消息。

## Core 复用与入站准入

Migration 122 为钉钉增加 account/publication/Bot/Owner identity 表，同时建立 provider-neutral directory view；Migration
123 把旧发布意图的 helper 模式无损迁移为 `direct_open_platform`。共享渠道
对象始终携带 `provider=dingtalk`，因此不会与飞书的 app、tenant、conversation 或 roster namespace 相撞。

入站顺序固定为：

```text
Stream callback fast ACK
→ normalize exact appKey / robotCode / corpId / senderStaffId / msgId
→ reject topic and group messages without one canonical atUsers target
→ Core verify Owner from appKey + userId digest
→ p2p exact /new OR group roster reconcile
→ group first observe as durable incomplete aggregate
→ 3-second single-App proof, then replay the same observation as canonical complete
→ finalize
→ PendingCampBinding or existing binding FIFO
→ CollaborationService atomic external-channel admission
→ CampMessage + CampTurn + initial AgentRun(s)
```

私聊按 receiving App 建 Quick Chat；精确 `/new` 只旋转该私聊 Camp，不创建触发消息或 Run。普通群首次有效消息在原群发送
一张项目卡，选择 opaque project ID 后冻结项目并处理原消息；绑定不可换绑。Owner 仍是 ExternalPrincipal，不获得本机
`local_user` 权限。reply 只冻结为本次消息的 ExternalQuote，入站附件只保留名称/媒体类型摘要。

群 roster 以远端当前机器人列表与本机 published DingTalk Bot 的交集为 authority，使用既有 membership
generation/source binding reconcile。加入/移出从下一次新 Run 生效，已运行 Run 与历史保持冻结。roster 不可读、出现未知
App 或目标已移出时 fail closed。

## 当前 Feature Gate

| 能力 | 当前状态 | 解除条件 |
| --- | --- | --- |
| Owner 私聊 | enabled | 真实租户 Web Session、Stream 与回复验收 |
| Owner 普通群显式 `@` | enabled | 真实群 roster、项目卡和输出验收 |
| 同消息直接多 Bot | disabled；普通群只有 `isInAtList` 且 canonical `atUsers` 恰好证明一个直接目标才进入 3 秒观察窗；缺失、歧义、多个 `atUsers` 或多个 receiving App 均整条 fail closed，单 Bot 协作扩展只走 Core A2A | 官方 canonical mention mapping + 多 App observation 真实证据 |
| 话题/Thread | disabled，出现任一 topic identity 即拒绝 | 独立话题群与消息 thread identity、roster、Camp mapping 证据 |
| 入站附件 | summary only | 官方下载、授权和 Managed Attachment ingress 设计 |
| 出站附件 | disabled，明确 unsupported | 已验证 app-only 原生投递和可恢复 message identity |
| AI 卡片 | 模板实例创建已取得隔离实测证据，生产 callback 尚待验收 | 真实投递、callback、streaming、终态翻页矩阵 |

不得通过宽松 parser、普通群 fallback、fabricated message success 或 Renderer 开关绕过这些 gate。

## 恢复与秘密

Core 在同一个 SQLite 保存 account、Developer Session、Bot credential、publication intent、Bot identity、conversation/
binding、roster、request、console 和 Outbox；Main 只保留运行期 `appKey/appSecret/robotCode` 与 Cookie jar。启动恢复所有
published Bot Stream，同时独立检查 Developer Session；Bot 不等待开发者页面或网络检查。暂时检查失败保留 Session，明确
Session 失效只阻止新的发布，不停止已有 Bot。周期 worker 重取已知群
roster、finalize ready aggregate、领取 delivery 并结算。任何外部失败都不从 Renderer 状态重建业务事实。

## Core authority 与渠道启动

渠道 Host 生命周期由 Main 的 `ChannelHostLifecycle` 与 Supervisor authority 对齐：只在 Core ready 且业务请求能力
可用后启动，每个 generation 一次；authority 丢失后串行停止，后续 generation 恢复后重新加载同一 SQLite 凭据。
旧启动的迟到结果先清理，App shutdown 后不再启动。Windows 尚未准入 data root 时不创建替代路径或渠道存储。

## References

- [DingTalk Channel v4](../contracts/dingtalk-channel-v4.md)
- [Channel Storage v2](../contracts/channel-storage-v2.md)
- [Camp Membership v1](../contracts/camp-membership-v1.md)
- [渠道设置](../ui/components/channel-settings.md)
- [v1.36 决策记录](../versions/v1.36/decisions.md)
