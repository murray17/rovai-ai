---
document_type: architecture
architecture: dingtalk-channel
authority: dingtalk-channel-component-and-authority-boundaries
status: accepted
last_updated: 2026-08-29
---

# 钉钉渠道架构

字段、状态和恢复合同见 [DingTalk Channel v1](../contracts/dingtalk-channel-v1.md)，共享 Camp admission、membership 与
模型输入分别继续由 [Feishu Channel v2](../contracts/feishu-channel-v2.md)中已经 provider-neutral 的渠道核心、
[Camp Membership v1](../contracts/camp-membership-v1.md)和
[ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)拥有。取舍理由见
[v1.31 决策记录](../versions/v1.31/decisions.md)。

## 组件与权威

```text
Renderer 渠道设置
  └─ typed Preload API
       └─ Electron Main / ChannelSettingsCoordinator
          ├─ Feishu Channel Host（既有）
          └─ DingTalk Channel Host
             ├─ OAuth Session Adapter / isolated DWS profile
             ├─ fixed DWS Developer Gateway
             ├─ Member Bot Provisioner
             ├─ OS safeStorage：每 App credential
             ├─ 每 App dingtalk-stream Client
             ├─ Open API：头像、roster、Markdown、AI 卡片
             ├─ inbound/card normalization
             └─ durable ChannelDelivery worker
                              │
                              ▼
                         Rust Core
             ├─ provider-specific account/publication/Bot identity
             ├─ provider-neutral Bot/Owner directory
             ├─ ExternalPrincipal / ExternalQuote
             ├─ conversation binding / PendingCampBinding
             ├─ ChannelTurnRequest / single-root FIFO
             ├─ unified atomic Camp admission / membership
             └─ execution console / ChannelDelivery outbox
```

Renderer 只呈现 Provider snapshot 和显式 Owner 动作。它不接触 OAuth Token、AppSecret、DWS profile 原文、控制面输出、
transport conversation 或 pending aggregate。Main 拥有外部网络和秘密；Core 拥有持久业务 identity、项目/Camp、admission、
membership 与 Outbox。DingTalk Host 不直接创建 CampMessage、CampTurn 或 AgentRun。

## Developer Gateway 与 OAuth

账号连接依赖预先注册的 Rovai DingTalk OAuth Client。浏览器 loopback 是默认交互，设备授权是用户显式 fallback；两者只
改变 OAuth UX，不改变账号 identity 或 Core 合同。开发和验收由宿主显式注入
`ROVAI_DINGTALK_OAUTH_CLIENT_ID/SECRET`。生产必须选择可分发 public client/device flow 或服务端 token broker；不得
硬编码 confidential secret、借用 DWS 内置 client、使用队员 AppKey 登录或失败后改成人工粘贴 credential。

当前 backend 是随 App 固定的 DWS 1.0.60 helper。`DingTalkDeveloperGateway` 在执行前校验平台 SHA，只允许 reviewed
operation 与参数；命令使用 `shell=false`、独立 `DWS_CONFIG_DIR`、有界 stdout/stderr buffer、超时和 AbortSignal。
OAuth Secret 只进入子进程环境，不进入 argv；Renderer 永远不读取 helper 输出。helper mutation 结果无法解析或应用创建
outcome 不明时 fail closed。该 Gateway 是可替换的 Main Adapter，不是 Core domain API。

macOS 包把原始 DWS 作为非可执行 gzip 资源封入已签名 App，避免 App 签名阶段重签并改变受审查的上游二进制。首次调用前，
Main 将载荷解到按版本与 SHA 分区的本机私有 runtime 目录，原子替换旧文件、设置 owner-only 执行权限并再次校验平台 SHA；
最终打包门禁同时拒绝 App 内可执行 DWS、损坏压缩资源和解包后摘要不符。Windows 继续随目标包携带固定的签名 EXE，并在
启动前执行同一平台 SHA 门禁。

DWS 支持多个 OAuth profile。切换账号时旧 profile 保持有效：Main 先记录当前 identity，再完成新 OAuth、读取完整
`corpId/userId/userName/corpName`，最后提交 Core account upsert。Core 失败时用 exact `corpId:userId` 切回旧 profile；
不删除两边登录态。断开只登出当前 Core account 对应的 exact profile，不关闭、迁移或删除已发布 Bot。

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

发布前复核当前 OAuth profile 与 intent 冻结的 `corpId + userId digest`。首次创建取得 `unifiedAppId` 后，必须在读取 Secret
或任何后续 mutation 前由 Core durable freeze。后续读取 App credential、上传受控队员头像、配置 Stream Robot、加入
`qyapi_robot_sendmsg`、`qyapi_chat_manage`、`Card.Instance.Write`、`Card.Streaming.Write` 和约定事件、创建版本、按远端 approval mode 显式选择审批人或发布、回读 release status，再启动 Stream
并创建官方 AI 卡片模板实例。每一步推进持久 publication intent，重启或失败只能从同一 App 恢复。

`NO_APPROVAL` 可直接发布；`SELECT_APPROVER` 必须把远端候选人投影到 Rovai Dialog，由 Owner 明确选择后继续；`AUTO`
按远端事实处理。提交审批后若状态仍为 audit/review，intent 停在 `awaiting_approval`，不是失败。publish 请求超时或返回
错误时先读 version status；已 release 就收敛成功，不能重复发布。只有 create outcome unknown 且没有任何可信 App ID
进入永久自动重建锁；一旦 identity 已冻结，所有失败都只能恢复原 App。

## Stream、卡片与输出

每个 published App 独立建立一个 `dingtalk-stream` Client，只订阅 SDK 的 Robot/Card topic。callback handler 先以当前
message ID 返回成功 ACK，再把 JSON parse、identity validation 和 Core admission 放入 microtask；慢业务不能占用 ACK
窗口。连接失败会从 registry 删除 client 并断开，其他 App 不受影响；App credential 只从 Main safeStorage 读取。

Open API 只接受 `appKey/appSecret` 换取短期 access token。群 roster、群/私聊 Markdown、受控 PNG 上传和卡片操作都使用
固定 API origin 与有界 timeout。AI 卡固定使用模板 `382e4302-551d-4880-bf29-a30acfab2e71.schema`、
`callbackType=STREAM`、`supportForward=false`。项目卡和执行卡 callback 仍须由 Core 校验 exact App、Owner userId、
outTrackId、nonce/version 或 AgentRun snapshot sequence；卡片 payload 不能直接改变项目或执行状态。

执行控制台消费 Core 的公开安全 projection。Main 只发送 narration、safe public command、公开文件变化和已提交输出；
command stdin/stdout/stderr、工具 input/output JSON、patch body 与推理不进入钉钉。运行态可 streaming update，sealed 终态
只通过授权的无状态页码更新原卡。正式 Agent 输出是新的 Markdown 消息，网络失败只结算 Outbox，不回滚 Core 消息。

## Core 复用与入站准入

Migration 122 为钉钉增加 account/publication/Bot/Owner identity 表，同时建立 provider-neutral directory view。共享渠道
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
| Owner 私聊 | enabled | 真实租户 OAuth、Stream 与回复验收 |
| Owner 普通群显式 `@` | enabled | 真实群 roster、项目卡和输出验收 |
| 同消息直接多 Bot | disabled；普通群只有 `isInAtList` 且 canonical `atUsers` 恰好证明一个直接目标才进入 3 秒观察窗；缺失、歧义、多个 `atUsers` 或多个 receiving App 均整条 fail closed，单 Bot 协作扩展只走 Core A2A | 官方 canonical mention mapping + 多 App observation 真实证据 |
| 话题/Thread | disabled，出现任一 topic identity 即拒绝 | 独立话题群与消息 thread identity、roster、Camp mapping 证据 |
| 入站附件 | summary only | 官方下载、授权和 Managed Attachment ingress 设计 |
| 出站附件 | disabled，明确 unsupported | 已验证 app-only 原生投递和可恢复 message identity |
| AI 卡片 | 本地 create/read shape 已实现，生产 callback 尚待验收 | 真实投递、callback、streaming、终态翻页矩阵 |

不得通过宽松 parser、普通群 fallback、fabricated message success 或 Renderer 开关绕过这些 gate。

## 恢复与秘密

Core 保存 account 显示字段/digest、publication intent、Bot identity、credentialRef、conversation/binding、roster、request、
console 和 Outbox；Main safeStorage 保存 `appKey/appSecret/robotCode`，DWS 隔离目录保存 OAuth profile。启动时先核对当前
OAuth identity，再恢复所有 published Bot Stream；OAuth 失效只阻止新的发布，不停止已有 Bot。周期 worker 重取已知群
roster、finalize ready aggregate、领取 delivery 并结算。任何外部失败都不从 Renderer 状态重建业务事实。

## References

- [DingTalk Channel v1](../contracts/dingtalk-channel-v1.md)
- [Camp Membership v1](../contracts/camp-membership-v1.md)
- [渠道设置](../ui/components/channel-settings.md)
- [v1.31 决策记录](../versions/v1.31/decisions.md)
