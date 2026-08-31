---
document_type: protocol-contract
contract: dingtalk-channel-v3
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 3
last_updated: 2026-08-30
---

# DingTalk Channel v3 Contract

本合同继承 [DingTalk Channel v2](dingtalk-channel-v2.md) 的 Bot 发布、Stream、Owner identity、项目绑定、admission、
投递和 feature gate；存储继续由 [Channel Storage v2](channel-storage-v2.md) 拥有。以下条款替代 v2 的登录方式与登录态
恢复语义，不改变显式断开连接，也不新增 Migration、数据字段或 Session schema。

## 1. 唯一浏览器登录入口

连接钉钉 → 系统浏览器扫码或确认 → 随机 state 绑定的 loopback callback → authorization-code exchange → 完整身份
→ staged Profile → Core 原子 `account.commitConnection` → 激活已提交 Profile。

- `ChannelsApi.connect(kind?: ChannelKind)`、Preload、IPC、Coordinator 和 DingTalk Host 不接受登录方式选项。
- `DingTalkDeveloperSessionService.beginLogin` 和 OAuth backend login 只接受取消信号及内部阶段回调，不接受 Device Flow。
- 仅保留固定 `https://login.dingtalk.com/oauth2/auth` 与 `https://api.dingtalk.com/v1.0/oauth2/userAccessToken`。
  删除设备码申请、设备 Token/轮询 endpoint、轮询延时、设备 URL 校验及相关备用调用链；不引入 DWS/CLI。
- Renderer 只有“连接钉钉／重新连接”；进行中显示浏览器登录阶段，可取消。没有隐藏或禁用的设备授权入口。
- callback 的 state 错误拒绝本次登录；用户取消和 `access_denied` 关闭本次流程，不形成账号过期或页面告警。
  浏览器打开失败、callback timeout、code exchange 或身份读取失败均保留旧账号。
- 取消后迟到的身份与阶段不得提交到 Core 或恢复 Dialog；loopback server 必须关闭。

OAuth Client 配置和官方域名、响应大小、超时、redirect 拒绝及 Main/Core 秘密边界不变。缺少受控 Client 时明确失败；
不得借用第三方工具的 Client 或队员 Bot 凭据。浏览器回调与生产 Client 的安全分发仍须独立完成真实环境验收。

## 2. 持久会话与静默续期

继续读取 `rovai.sqlite` 的 schema-1 `StoredDingTalkDeveloperSessions`，按 `corpId + userId` 定位当前 Profile。
本次不删除、迁移或重置既有 Profile；原来任何登录方式得到的合格 Profile 均可继续使用。退出应用或重启不是失效证据。

有效 access token 直接从恢复的 Profile 使用，不打开浏览器。即将过期或已到期时用当前 refresh token 静默更新，再通过
Session revision CAS 保存。并发 inspect/accessToken 必须串行复用一次刷新结果，不重复兑换同一旧 refresh token。

刷新已成功但 SQLite 保存失败时，Main 暂存该次轮换结果；下次先重试保存而不是再次使用旧 refresh token。若提交回执丢失、
账号已切换或已断开，先读取最新 Session revision：采用 Core 的新状态，禁止覆盖新账号或复活已删除会话。秘密不进入
Renderer、日志、命令行或其他文件。

## 3. 暂时失败与明确失效

`inspect()` 的 `null` 仅表示本地确实没有当前 Profile；本地读取、解析、保存、网络和超时异常不得转换成 `null`。
解析失败不能缓存为“已加载的空会话”，恢复后必须允许重新读取。

Host 启动只在确认没有 Profile、refresh token 不可用或已到期、明确收到 refresh grant 失效或完整身份不匹配时，才可按原
account/version 调用 Core expire。普通网络错误、408/429/5xx、未知拒绝、Client 配置错误、响应不完整或 SQLite 错误
均保留既有登录态；只拒绝需要该身份的本次操作，不触发自动扫码，不删除 Bot credential。

token endpoint 的 HTTP 401 本身不等于用户授权撤销。明确的 refresh `invalid_grant` 才映射到
`dingtalk_oauth_expired`；`invalid_client` / `unauthorized_client` 为 Client 配置拒绝。未知错误 fail closed 并允许重试，
不猜测失效，也不把远端响应正文带出 Main。timeout 必须覆盖响应正文读取。

启动检查跨越显式连接/断开或 Host stop 时丢弃迟到结果；旧检查不能把当前账号变为过期。既有 Bot 仍以独立 App
credential 恢复，OAuth 检查异常不能阻止该恢复。明确失效的用户提示固定为“登录已失效，请重新连接”。

## 4. 验收边界

自动化覆盖浏览器 callback、取消/state 拒绝与 server 清理、旧 Profile 重启复用、串行静默续期、授权失效后显式重连、
断网/超时保留、刷新保存重试/回执丢失、并发账号变更 fence 和唯一 Renderer 入口。Bot 发布、Owner、Stream、项目与断开
连接回归保持原合同。真实扫码和远端授权撤销仍需隔离账号环境验收；mock 通过不等于远端验收完成。

## References

- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [钉钉浏览器授权说明](https://open-dingtalk.github.io/developerpedia/docs/develop/permission/token/browser/get_user_app_token_browser/)
- [OAuth 2.0 Token Error Response](https://datatracker.ietf.org/doc/html/rfc6749#section-5.2)
