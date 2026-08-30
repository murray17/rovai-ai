---
document_type: protocol-contract
contract: channel-storage-v1
authority: channel-credential-and-developer-session-storage
status: accepted
version: 1
last_updated: 2026-08-30
---

# Channel Storage v1 Contract

本合同拥有飞书、钉钉及后续渠道的长期 Bot credential、Developer Session、启动恢复和原子提交边界。它替代
[Feishu Channel v2](feishu-channel-v2.md)与[DingTalk Channel v2](dingtalk-channel-v2.md)中关于 OS
`safeStorage`、Keychain、Credential Manager 和独立 `.bin` 文件的存储条款；两份 Provider 合同的账号身份、发布状态机、
入站、传输和投递语义保持不变。

## 1. 权威与秘密边界

`<userData>/rovai.sqlite` 是渠道持久 credential 与 Developer Session 的唯一来源。数据库中的 secret、Token、Cookie 和
`payload_json` 是明文；Rovai 不调用 Electron `safeStorage`、macOS Keychain、Windows Credential Manager/DPAPI 或 Linux
Secret Service，也不创建第二个 `channel.sqlite`。

只有 Rust Core 与 Electron Main 可以读取这些字段。Renderer、Preload 公共 snapshot、Agent Context、诊断导出、日志、错误
detail 和命令行参数都不得包含 raw App Secret、OAuth Token、Cookie、完整 identity/session JSON 或 credential payload。
Renderer 只能看到 App ID 等公开身份、`hasCredential`、连接状态和安全错误码。

## 2. SQLite schema

Migration 124 创建：

```sql
channel_credentials(
  credential_ref PRIMARY KEY,
  provider, credential_kind, remote_app_id, payload_json,
  schema_version, revision, created_at, updated_at,
  UNIQUE(provider, credential_kind, remote_app_id)
)

channel_developer_sessions(
  provider PRIMARY KEY,
  account_id, identity_json, session_json,
  schema_version, revision, created_at, updated_at
)
```

当前 `provider` 闭集为 `feishu | dingtalk`，`credential_kind` 为 `member_bot`，schema/revision 都从 1 开始。
`remote_app_id` 对飞书是 App ID，对钉钉是 AppKey。Feishu `payload_json` 只含 `appSecret`；DingTalk 只含
`appSecret + robotCode`。Core 在读写时解析并校验 JSON、大小、Provider shape、credential ref 前缀、远端身份唯一性和
revision，不依赖 SQLite JSON 扩展。

Feishu Developer Session 的 `identity_json` 包含 brand、user/tenant identity，`session_json` 只含受限飞书/Lark 域 Cookie；
DingTalk identity 包含 corp/user identity，session 是 schema 1 的 OAuth profiles 和 active profile key。单个 Provider 只有一条
当前 Session。

## 3. Main-only Core API

以下方法只允许 Provider Channel Host 使用，不加入 Renderer allowlist：

```text
channels.credentials.get
channels.credentials.listPublished
channels.credentials.delete
channels.developerSession.get
channels.developerSession.replace
channels.developerSession.delete
channels.feishu.account.commitConnection
channels.dingtalk.account.commitConnection
channels.feishu.publicationIntent.storeCredential
channels.dingtalk.publicationIntent.storeCredential
```

`channels.credentials.listPublished` 一次查询 JOIN 两个 Provider 的 published Bot 与 exact `credentialRef + remote_app_id`，返回所有
可启动 credential；缺 row、Provider 不符或 App identity 不符的 Bot 不返回。Main 启动时只调用一次并在内存分发给两个 Host，
随后消息发送、重连和状态刷新复用运行期对象，不逐 Bot 查询 SQLite。

`developerSession.replace` 要求账号仍 connected、accountId 不变且 `expectedRevision` 精确匹配；refresh 后的新 Cookie/Token
使用该 compare-and-swap 路径。

## 4. 原子账号连接

新登录先创建临时 Electron Session/Profile：

```text
临时登录 → 读取完整 identity → 收集 Cookie/Token
→ account.commitConnection(account + developerSession)
→ 同一 SQLite 事务写 Session 与 connected account
→ 提交成功后切换 Main 内存 Session
→ 清理旧内存 Session
```

事务前不得改写既有 SQLite account 或 Session。version conflict、identity mismatch 或存储失败时整笔回滚，Main 只丢弃临时
Session，旧账号继续有效；不需要持久化层 `confirmLogin`、`rollbackLogin` 或旧 Session 文件备份。

断开和 expire 命令在同一 Core 事务删除对应 `channel_developer_sessions` row 并更新账号状态；已发布 Bot credential、远端 App
和已运行的 Bot 连接不因此删除。

## 5. 原子发布 credential

Provider 取得可信远端 App identity 与 credential 后调用 `publicationIntent.storeCredential`。单一事务必须：

1. 核对 intent、expected version、冻结远端 App 和 credentialRef；
2. 插入或更新 exact `channel_credentials` row，既有远端身份不可换绑；
3. 把同一个 credentialRef 写入 intent；
4. 推进到 `credentials_read` 并增加 intent version；
5. 一起提交或一起回滚。

后续配置、发布或连接失败保留 credential，恢复只读取同一 ref/App；不得重新创建远端应用。永久删除 Bot 时只有在没有 Bot
引用后才能删除 credential。

## 6. 恢复、错误与旧文件

启动有 Session 时，Main 恢复 Electron Cookie/Profile、在线复核 identity，并用 revision CAS 保存远端刷新内容。Session 不存在
时账号表现为未连接；Session 过期或 identity 漂移时 Core 删除 Session 并标记过期，但 published Bot 仍可用自身 credential
启动。

既有 Bot 缺少 SQLite credential 时统一为 `published_bot_credential_missing`，不得读取旧文件或访问系统凭据库。重新发布只恢复
同一冻结 App。

旧 `<userData>/channel-credentials/*.bin` 不迁移、不解密、不解析。Electron Main 在 Core 启动后只能按已知文件名和严格
`feishu-|dingtalk-` pattern 做 best-effort unlink；文件存在与否不影响 Migration 或启动。`system_credential_encryption_unavailable`
以及 `checking_secure_storage` / `securing_session` 已退役，UI 阶段改为
`loading_local_session` / `saving_local_session`。

## 7. Data Contract

Migration 124 只接受完整 `Data Contract v1.36 / projection schema 77` 且 Migration 123 已存在的 store。它只新增两张渠道存储
表，不导入 `.bin`、不读取系统安全存储、不修改 Provider account/Bot/publication、Camp、消息、Run、Outbox 或 Attachment
业务 row；完成后写入 `Data Contract v1.37 / projection schema 78` 与 Migration 124。重启必须幂等。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [v1.33 决策记录](../versions/v1.33/decisions.md#v1-33-d04)
