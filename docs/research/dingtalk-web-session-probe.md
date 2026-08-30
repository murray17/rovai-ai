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

**完整 Bot provisioning 尚未验收通过。** 本次授权创建一个未发布测试应用；创建接口两次明确拒绝，
第二次是确认完整应用列表仍为空之后的有界诊断重试，返回 HTTP 400 / `errorCode: 67010`。
没有取得应用 ID，没有创建、发布或删除远端应用。当前验收组织的只读权限事实为：

```json
{
  "APP_DEVELOP": false,
  "ROBOT_DEVELOP": false,
  "ORDINARY_DEVELOP": true,
  "isMainOrgAdmin": false,
  "canSelfBuild": false
}
```

不能把 `ORDINARY_DEVELOP`、能进入后台或能列出应用等同于企业应用创建权限。尚未取得 `67010`
的权威错误说明，不将它硬编码成“Session 过期”。继续真实创建验证需要用户提供有企业应用开发能力的
测试组织或取得所需权限；不得尝试提权、创建另一类应用绕过限制，或改用未授权企业。

此记录只拥有研究证据，不替代 [DingTalk Channel v3](../contracts/dingtalk-channel-v3.md) 或
[Channel Storage v2](../contracts/channel-storage-v2.md)。工作分支的 Web Session 替换仍在实施中；
现行钉钉合同和开发文档仍描述 OAuth，后续必须随完整实现同步，不能宣称已经交付。

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

候选实现保留以下边界：

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
除身份/列表/权限读取和被拒绝的创建请求外，下面各应用级操作尚无成功实测，不能仅凭存在路径就宣告接入完成。

| 能力 | 当前页面中的接口 |
| --- | --- |
| 普通企业应用创建 | `POST /openapp/unifiedapp/create`；`appType: 2`、`appName`、`appDesc` |
| 应用读回/修改 | `/openapp/unifiedapp/{id}/get`、`/update` |
| 凭据只读获取 | `GET /openapp/unifiedapp/{id}/getClientCredentials` |
| 应用能力 | `/openapp/unifiedapp/{id}/abilityList`、`/ability/enable` |
| 权限 | `/openapp/unifiedapp/{id}/scope/authScope`、`/scope/submitApiAuthAudit` |
| 版本读取/保存/发布 | `/openapp/unifiedapp/{id}/getVersion`、`/commitVersion`、`/publishVersion` |

凭据读取应采用现代 `getClientCredentials` 协议；当前工作分支 Gateway 的旧 `agentId` 凭据适配仍待替换。
机器人、事件、版本与审批写操作尚未全部适配，暂时拒绝未验证协议，不回退到 OAuth/MCP。
后续必须实测同一应用的凭据、头像、Stream 模式、权限/事件、版本、审批、发布与读回，且保留首次取得可信
应用 ID 就冻结、失败只 reconcile 同一应用的语义。普通企业应用不能与 OpenClaw 模板或独立旧机器人混用。

## 来源

- [钉钉官方创建机器人教程](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/java/create-bot/)
- [钉钉官方开发者权限说明](https://opensource.dingtalk.com/developerpedia/docs/explore/portal/grant-admin/)
- [官方应用开发前端 0.138.2](https://g.alicdn.com/dingding/opdf-application-development/0.138.2/umi.js)
- [官方应用管理前端 0.89.0](https://g.alicdn.com/dingding/opdf-app-manage/0.89.0/umi.js)
- [官方应用管理页面 0.89.0](https://g.alicdn.com/dingding/opdf-app-manage/0.89.0/p__index.async.js)
- [Electron ClientRequest](https://www.electronjs.org/docs/latest/api/client-request)
- [Electron Cookies](https://www.electronjs.org/docs/latest/api/cookies)
