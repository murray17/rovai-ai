---
document_type: protocol-contract
contract: dingtalk-channel-v4
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 4
last_updated: 2026-08-30
---

# DingTalk Channel v4 Contract

继承 [DingTalk Channel v3](dingtalk-channel-v3.md) 的单一连接入口，以及 v2 的 Owner、Camp、admission、投递和
feature gate。以下条款替代 Rovai OAuth Client、token profile 和 developer service 的登录/发布协议。
通用 SQLite 事务与凭据权限仍由 [Channel Storage v2](channel-storage-v2.md) 拥有；不新增数据库 Migration。

## 1. Main-owned Developer Web Session

连接钉钉 → Main 隔离窗口打开官方开放平台 → 用户扫码/确认并选择组织 → `/baseInfo` 读取完整身份
→ 暂存 Cookie Snapshot → Core 原子提交 account + Session → 激活新 Session。

- 不需要 Rovai OAuth Client ID/Secret、loopback server、authorization code exchange、Device Flow 或 DWS。
  平台自己的 SSO 页面仍可能使用 OAuth URL；Rovai 不复用其 Client Secret，也不实现第二套扫码协议。
- Owner identity 为 `corpId + staffId`；`userId` 保存组织内 `staffId`。昵称、SSO UID、手机号不能替代身份。
  每次控制台操作串行校验冻结的企业和 Owner；检查失败不继续 mutation。
- Electron 使用随机、非 `persist:` Session，禁止借用 Chrome Profile 或日常 App 的 Cookie。
  登录窗口不启用 Node、DevTools 或页面权限；新窗口及非允许域名导航拒绝。
- 登录/SSO 成功后将允许的 Cookie Snapshot 恢复到 API-only jar，并通过 `/baseInfo` 复核后才接管。
  不降级 Secure/HttpOnly/SameSite，不从 Renderer 导出凭据。
- 新账号必须经过完整身份读取和 Core 原子提交后才能替换旧账号；取消、网络或存储失败只丢弃 staged Session。

## 2. 存储、续接与旧数据

Provider Session JSON 为 `{ schemaVersion: 2, cookies: StoredDingTalkCookie[] }`，仍写现有
`channel_developer_sessions`。Cookie 只含经校验的 name/value/domain/path、Secure、HttpOnly、SameSite、session、
hostOnly 和原始 expirationDate；禁止未知字段、重复 Cookie key 或非允许平台域名。旧 `oauthProfileRef` wire 字段只保留
为身份引用，不包含 OAuth Token、Cookie 或 Profile 原文。

关闭/重启不等于失效。恢复不延长 Cookie 到期时间；控制台 `access_token` 可以是没有固定客户端过期时间的 Session Cookie，
不能承诺固定有效天数。只有明确登录拒绝时，`inspect()` 才让平台自己的 SSO 在隐藏隔离窗口续接；无法自动续接后提示重连。
Rovai 不兑换额外 refresh token。普通网络、页面、解析和 SQLite 异常保留原 Session，不自动扫码或删除 Bot credential。

Chromium 接受响应 Set-Cookie；操作前后由 Main 按 Core revision/CAS 保存。保存失败先保留内存轮换结果，下次先补存或
采用 Core 的较新 revision，不能覆盖新账号或复活断开的 Session。创建返回可信 App ID 后，即便 Cookie 保存失败，也必须
先把该 ID 交给 Core 冻结，不能把存储失败伪装成远端创建未知。

旧 schema-1 OAuth Profile 不能转换为浏览器 Cookie。保留旧 SQLite row 和 Bot 绑定，提示显式重新连接；只有新登录成功且
Core 原子提交后替换旧 row。旧 Profile 不参与 OAuth 请求，也不因读取它就删除数据。

## 3. 封闭控制台传输

Main 只向固定 `https://open-dev.dingtalk.com` 的 reviewed path 发请求，使用同一个 Cookie jar；按官方页面协议将
`access_token` Cookie 解码一次再编码进 query，并携带 `_csrf_token_` header、Origin/Referer。这个带凭据 URL 不得
进入 Renderer、日志、异常文本、命令行或诊断。任意 URL、token override、路径穿越和非白名单参数均在请求前拒绝。

请求/响应均有 timeout、取消和大小边界。手动处理 redirect，不追随携带凭据的跳转；仅明确登录跳转/401/业务 302 视作
登录拒绝。HTTP 400 的有界数字业务码可以公开，远端 message/body 不公开；未知失败不能猜成过期。
成功的 `success:true` envelope 即使没有 data，也可以是合法 mutation 成功，之后仍以具体资源读回确认结果。
Session 层不自动重放任何 mutation。

这些控制台 API 是官方网页当前使用的内部协议，不是平台承诺稳定的公开 OpenAPI。未知 wire shape 必须停止当前步骤，
保留原 App 身份；不回退 OAuth/MCP、第三方 CLI、页面点击创建或猜测接口。

## 4. 应用、凭据与头像

`POST /openapp/unifiedapp/create` 只创建普通企业内部应用：`appType:2, appName, appDesc`，不使用 AI/OpenClaw 模板。
请求前按平台字符集合处理名称与描述；名称最多 20 字符、至少 2 字符，描述 4–200 字符。Rovai 文案中的中点和中文分号
替换为空格，不能收到 `67010` 后自动更换参数重试创建。

`account_verified` 在创建请求前 durable 提交。恢复时如果该状态仍无 App ID，不能证明创建未发出，必须转为
`failed_unknown_remote_state` 并停止自动创建。明确远端拒绝才允许 `failed_recoverable` 的再次创建。
取得合法 `unifiedAppId` 后立即 Core freeze，之后才读取 Secret 或修改应用。冻结回执失败仍携带已知 App ID，由 Host
读取最新 revision 后写入失败事务；不能丢掉 ID 再建应用。无法保存时保留创建前 fence。

`GET /openapp/unifiedapp/{id}/get` 必须返回同一 ID 和 `appType:2`。
`GET .../getClientCredentials` 的 `clientId` 必须匹配该应用，`currentSecrets.secretStatus` 必须为 `ENABLED`，
`clientSecret` 非空且不含掩码。禁止把 unifiedAppId 猜成 agentId、走旧 Secret endpoint 或重置 Secret。
AppKey/Secret 仍通过 Core credential/intent 原子事务冻结。

头像只读取 Main 受管队员 PNG（≤2MiB），通过 `/microapp/uploadPic/logo.json` 的 multipart `file` 上传；不用 Bot OpenAPI
media upload 结果充当应用头像。接受受控平台 CDN 的 `logoImg + logoImgUrl`，随后 `/update` 必须同时带当前冻结应用的
appName、appDesc、appIcon、iconUrl，并精确读回。missing icon 和 HTTP 成功但未生效都不算通过。

## 5. Bot 能力与权限

先读取 `abilityList`，仅在需要时用 `ability/enable {unifiedAppId, abilityTypes:["bot"]}` 开启 bot 能力，再配置机器人。
当前官方 UI 通过 legacy provider ID 配置机器人；必须从 exact App 的 `providerAppId` 读取 `/app/inner/get?id=...`，
同时核对 inner ID、unifiedAppId 和 AppKey，再读取 `/openapp/inner/robot/get?appId=...`。

没有机器人且不存在矛盾绑定时调用 `/openapp/inner/robot/create`；已有机器人只读核对或 `/update`，不能重建 App。
请求使用已冻结应用的名称/描述、队员 iconMediaId/previewMediaId、`mode:1`、`requestType:"json"`。
读回 `mode:1` 才规范化为 STREAM，`status:2` 才是 ONLINE；Robot Code 必须来自已验证响应，不能用猜测掩盖缺失。
已完成的相同配置不重复写入。

最小权限为 `Card.Instance.Write`、`Card.Streaming.Write`、`qyapi_chat_manage`、`qyapi_robot_sendmsg`。
读取 `scope/list` 中的 `scopeList[].openApiScopeVO.value` 和 `authed`，不能把数字 status 当作授权事实。
只对缺少的请求权限发送 `scope/authScope`，body 的 `scopeValue` 是 JSON 编码的字符串数组，另有 `isIsvScope:false, from:""`。
缺失/重复权限、不可编辑或敏感审批条件不明时停止；写后逐项核对。不能顺手申请整个权限目录。

Robot/Card 回调使用 SDK Stream topics。当前没有要求额外 business event code；非空、未验证的事件订阅请求保持
`dingtalk_console_protocol_unverified`，不能宣称已实现所有企业事件订阅。

## 6. 冻结版本、审批与恢复

创建应用时已有初始 draft。`app.version.create` 只读取并返回该空白 INIT draft 的 ID，不发版本 mutation；Core 先提交
`version_created`，然后 `app.version.configure` 才向同一个 versionId 发 `commitVersion`。
初次版本使用 `1.0.0`，scopeSelf=true，scopeVO 只包含当前 Owner 的 UID；UID 必须从 staffId 精确匹配的 scope 解析，
不选择全员/部门/其他账号。已经提交且内容一致的 draft 只读验证；非空的冲突 draft 不覆盖，也不另建版本。

- `DING_BPMS + requiredApproval:false` 规范化为 `NO_APPROVAL`；不能仅因字面值 DING_BPMS 就判审批失败。
- `requiredApproval:true` 按官方 `permission/member?publishFlag=true` 读取候选 staffId，Owner 必须显式选择；提交前重查候选。
  不自动选管理员，不把敏感权限确认置为 true。企业自建审核映射 AUTO，但不因此报告已发布。
- `publishVersion` 固定同一 unifiedAppId/versionId、`confirmedSensitive:false`，必要时附 Owner 选定的 approvers。
- 发布前和发布后均读取冻结 versionId；RELEASE 成功，AUDIT 等待。已发布或审批中的版本不重复提交。
  请求超时先读回，已 RELEASE 就收敛成功；其他失败保留同一 App/版本继续核对。
- 发布后 App 的 current versionId/versionStatus 可以自动变成新空白 INIT draft；它不能否定已冻结版本的 RELEASE。
- completed 只表示曾发布成功。缺少本地 credential 时只读同一应用 Secret、Robot 和冻结版本，补写 SQLite 后重连；
  不重新上传头像、提交版本或创建应用。冻结 App 的名称也不随本机队员重命名而改变。

## 7. Stream 与验收边界

Stream 仍由 Main 的 `dingtalk-stream` 直接连接。`connect()` Promise resolve 不是成功事实；必须在有界期限内确认
client.connected。不要依赖 SDK registered 字段。并发 start 复用同一次 readiness，失败/超时断开并移出 registry，
stop 或替换后的迟到 callback 不进入 Core。Robot/Card handler 仍先 ACK，再异步规范化和 admission。

自动化必须覆盖实际 wire 字段、PNG multipart、void success、身份冲突、创建/版本 freeze 顺序、审批与 Owner-only scope、
未知创建锁、只读 completed 恢复、Cookie CAS、网络失败保留，以及 SDK 假成功/超时/迟到连接。
隔离实测发布、WebSocket 或模板实例成功不能替代 Owner 入站、Core Camp、群项目卡、callback、断线恢复和 packaged
重启验收；这些未完成时保持相应生产 gate。证据见[Web Session 实测](../research/dingtalk-web-session-probe.md)。

## References

- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [Channel Storage v2](channel-storage-v2.md)
- [V1.36-D05](../versions/v1.36/decisions.md#v1-36-d05)
- [本地验收边界](../development/local-workflow.md#钉钉-web-session-验收前置)
