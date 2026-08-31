---
document_type: research
authority: research-evidence
status: not_qualified
last_updated: 2026-08-30
---

# 钉钉 Developer Web Session 实测

## 当前结论与边界

Main-owned Web Session 已能读取开发者企业身份、保存与恢复 Cookie，并在保留平台 SSO 的情况下
重新取得控制台 Token。它不需要 Rovai OAuth Client、第三方 Client Secret、DWS 或浏览器用户 Profile。

用户后来创建并授权使用新的测试组织，又授权走完同一测试应用的配置/发布流程。该组织已成功创建一个普通
`appType:2` 企业内部应用 `Rovai-WebSession-Probe`，取得凭据、配置头像/Bot/四项最小权限，提交并发布 Owner-only
可见范围的 `1.0.0`。没有额外创建第二个应用，没有删除应用或扩大企业权限。

App-only OpenAPI 已接受一条明确标注开发验收的 Owner 私聊消息；Stream 已连接，AI 卡片实例已创建。
编译后的产品 Gateway/Provisioner 也通过同一应用的只读 completed 恢复（AppKey、Secret、Robot、冻结版本一致，零 mutation），
产品 PNG 上传与 Stream Registry 就绪检查通过。**Owner 入站回复、完整 Core Camp/群聊与卡片 callback 尚未完成实测**，
不能把发布或实例创建成功等同于渠道生产全链路通过。

### 早期组织的拒绝记录

早期组织的创建请求曾两次明确返回 HTTP 400 / `errorCode:67010`；没有取得 App ID，完整应用列表仍为空。
该组织当时的只读权限事实为：

```json
{
  "APP_DEVELOP": false,
  "ROBOT_DEVELOP": false,
  "ORDINARY_DEVELOP": true,
  "isMainOrgAdmin": false,
  "canSelfBuild": false
}
```

不能把 `ORDINARY_DEVELOP`、能进入后台或能列出应用等同于企业应用创建权限。早期响应未记录权威说明，
不能事后把它断言为权限问题或 Session 过期。新测试组织的一次 `67010` 则明确给出应用描述字符限制；
使用完整列表确认仍为空后，移除不允许的中文分号等字符，仅做一次有界创建重试并成功。
官方前端正则也不允许 Rovai 常用的中点 `·`。产品在发请求前规范化名称/描述，而不是自动重试创建。

此记录只拥有研究证据，不替代 [DingTalk Channel v4](../contracts/dingtalk-channel-v4.md) 或
[Channel Storage v2](../contracts/channel-storage-v2.md)。当前合同已切换到 Web Session，生产资格仍按未完成项保留 NO-GO。

## 已验证的登录与恢复

验证环境是独立 Electron 43.1.1 进程、独立临时 `userData` / Skill Library，没有启动 Core 或真实 Runtime，
也没有修改日常 App 数据。

- 用户在官方钉钉登录窗口扫码并选择组织。
- `GET /baseInfo` 返回 `corpId`、`staffId`、`orgName`、`nick`；Owner 必须取组织内 `staffId`，不能
  用 SSO UID、昵称或手机号替代。
- Cookie Snapshot 保存到权限受限的临时 SQLite，退出整个 Probe 后，从该库恢复到全新 Session，
  无需扫码即可读回相同企业和 Owner 身份。
- 在独立副本中删除 `access_token` Cookie，保留平台 SSO Cookie，运行正式 `inspect()`，可重新取得
  控制台 Cookie，身份相同；原始 Session 未修改。

该证据证明 Cookie 序列化和原生传输可恢复，**不等同于正式 Core 数据库和 packaged App 的全链路重启验收**。
后者仍需完成。取消、网络异常、存储失败与明确失效的区别，以及 CAS 保存边界由测试覆盖。

## 会话刷新与存储

实际控制台 `access_token` 是无固定到期时间的 Session Cookie。不能从其他跟踪 Cookie 的到期时间推算
登录有效期，也不能承诺“固定 N 天”。服务端仍能提前撤销会话。

当前实现保留以下边界：

1. SQLite 是唯一持久凭据权威；Electron 使用随机、非 `persist:` 的内存 Session。
2. 保存经过域名和字段白名单校验的 Cookie（schema 2），包括 session 标记、原始过期时间、host-only、
   Secure、HttpOnly、SameSite。恢复不延长服务端给定的过期时间。
3. Main 请求携带控制台 Cookie、解码后只编码一次的 `access_token` query 和 `_csrf_token_` header。
   不是把 Web Session 换成 Rovai OAuth Token，也不是用 Bot AppKey 模拟用户登录。
4. Chromium 接收响应 `Set-Cookie`；操作后使用 Core revision/CAS 保存轮换结果。明确失效时才要求重连；
   网络、页面、存储异常不删除已有 Session。
5. `inspect()` 在明确登录拒绝后允许官方 SSO 在隔离窗口里续接；没有额外 OAuth refresh token，
   不复制钉钉官方登录应用的 Client Secret。应用创建等写请求绝不由 Session 层自动重放。
6. 沿用当前渠道 SQLite 明文存储决策，不增加 Keychain、DPAPI 或 `.bin` 后备。数据库及其备份必须按
   秘密数据保护，Cookie/Secret 不进入 Renderer、日志、命令参数或公开研究附件。

首登浏览器 Cookie jar 与恢复后的 API jar 在本次 Electron 环境中发送的 Cookie 集合不同；浏览器 jar
中的部分 Cookie 能被 `cookies.get()` 读到，却未随 Main HTTP 请求发出。将白名单 Snapshot 恢复到
不承载浏览器页面的新 jar 后正常。实现因此在登录/SSO 完成时验证并切换到 API-only jar，保持 Cookie
安全属性不变；没有禁用安全策略、手动降级 Cookie 标记或使用用户浏览器 Profile。底层 Chromium 原因
尚未确定，不能将推测当作事实。

原生传输还覆盖两个已复现差异：`session.fetch` 对 manual redirect 抛错，而不是交付 302；
`ClientRequest` 可先触发请求 close，再交付 response。实现读取 redirect 事件且以响应完成/错误或超时
收敛，不把请求 close 单独视作失败。

## 当前页面提供的接口证据

这些是钉钉当前官方控制台代码中的内部接口，**不是承诺稳定的公开 OpenAPI 合同**。
下表区分成功实测与仍需验证的能力；路径存在本身不构成产品验收。

| 能力 | 接口与实测结论 |
| --- | --- |
| 连接不创建应用 | 登录/身份读取后应用列表保持 0；显式创建后变为 1 |
| 普通企业应用创建 | `POST /openapp/unifiedapp/create`，`appType:2/appName/appDesc` 成功；未用模板 |
| 现代凭据读取 | `getClientCredentials` 的 clientId 匹配 exact App；currentSecrets 为 ENABLED、Secret 未掩码 |
| 队员头像 | `/microapp/uploadPic/logo.json` multipart 成功，返回 logoImg/平台 CDN URL；产品代码复测通过 |
| 应用头像更新 | `/update` 只有同时带当前 appName/appDesc 才生效，精确 `/get` 读回通过；只传 icon 曾发生成功但 no-op |
| bot 能力 | `abilityList` + `ability/enable` 成功，只启用 bot，不启用 h5/miniapp |
| Stream Robot | exact providerAppId → `/app/inner/get` → `/openapp/inner/robot/get/create`；读回 mode=1/status=2/name/icon/robotCode |
| 最小权限 | `scope/list` + `scope/authScope` 成功，四项权限 authed=true；scopeValue 是 JSON 字符串而非数组，成功可无 data |
| 版本配置 | 沿用初始 draft ID，`commitVersion` 为 1.0.0、scopeSelf=true、仅 Owner UID；不是全员可见 |
| 发布与读回 | `publishVersion` 成功可无 data；冻结 versionId 为 RELEASE，versionList 中只有一个发布版本 |
| 当前 draft 差异 | 发布后 app.get 的 current versionStatus 为 INIT；不能用它否定旧冻结版本 RELEASE |
| 审批 | 本组织 DING_BPMS + requiredApproval=false，无需选审批人；需审批组织只依据官方前端实现与 mock，未实测 |
| Stream | 官方 SDK 以及产品 Registry 均 connected=true；registered=false 不妨碍 WebSocket 已建立 |
| 出站/AI 卡 | 产品 OpenAPI Owner 私聊请求已接受、模板实例创建成功；尚未验证用户侧入站或卡片 callback |

机器人更新接口由官方前端确认，但本次已配置后的同一机器人只做幂等读回；未额外改成另一种模式来制造更新。
没有请求额外 business event code，Robot/Card 使用 Stream topics；不能宣称所有企业事件 API 已验证。
源码、协议与已运行事实分别记录；没有把隔离 Probe 当作 packaged App 或 Core/Renderer 全链路验收。

## 来源

- [钉钉官方创建机器人教程](https://open-dingtalk.github.io/developerpedia/docs/explore/tutorials/stream/bot/java/create-bot/)
- [钉钉官方开发者权限说明](https://opensource.dingtalk.com/developerpedia/docs/explore/portal/grant-admin/)
- [官方应用开发前端 0.138.2](https://g.alicdn.com/dingding/opdf-application-development/0.138.2/umi.js)
- [官方应用管理前端 0.89.0](https://g.alicdn.com/dingding/opdf-app-manage/0.89.0/umi.js)
- [官方应用管理页面 0.89.0](https://g.alicdn.com/dingding/opdf-app-manage/0.89.0/p__index.async.js)
- [Electron ClientRequest](https://www.electronjs.org/docs/latest/api/client-request)
- [Electron Cookies](https://www.electronjs.org/docs/latest/api/cookies)
