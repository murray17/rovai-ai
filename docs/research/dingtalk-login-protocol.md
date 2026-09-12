---
document_type: research
authority: dingtalk-login-protocol-evidence
status: observed-with-verification-limits
last_updated: 2026-09-12
---

# 钉钉开发者后台扫码协议调查

本文记录当前公开网页实现与隔离请求观察，不将内部网页接口提升为钉钉公开 OpenAPI 的稳定承诺。
Rovai 的边界由 [DingTalk Channel v13](../contracts/dingtalk-channel-v13.md) 拥有。

## 来源与调用顺序

2026-09-12 从[开发者后台入口](https://open-dev.dingtalk.com/)取得统一认证重定向和 Cookie；实际入口为
`login.dingtalk.com/oauth2/challenge.htm`，携带后台 client_id、`response_type=code`、`scope=openid corpid`
及指向 `open-dev.dingtalk.com/dingtalk_sso_call_back` 的 redirect_uri。参数和 Cookie 只在隔离临时上下文使用，
本记录不保存含关联信息的完整 URL、二维码、授权码、设备数据或会话凭据。

网页引用的[官方登录脚本 0.122.0](https://g.alicdn.com/dingding/h5-dingtalk-login/0.122.0/login.js)
SHA-256 为 `4e989a54e5b335d21c263f8235696bf03fd8416780daa63da9d55114097dd344`。
该摘要只标识本次调查来源，不成为运行时 allowlist 或版本锁定。

| 步骤 | 当前脚本中的协议 | 核实范围 |
| --- | --- | --- |
| 登录上下文 | 入口重定向的查询参数与 `window.__LOGIN_PAGE_VARS` 惰性结构化数据 | 实际 HTTP 入口和静态 bootstrap 解析通过；不执行脚本或观察文案 |
| 初始化 | `POST /oauth2/generate_qrcode`，表单合并本次 challenge 参数 | 脚本调用与匿名实测均确认；成功封装为 `{success:true,result:<完整扫描链接>}` |
| 扫描内容 | `https://login.dingtalk.com/oauth2/qr_confirm.htm?code=...` | 本次响应提供完整链接；不使用裸票据或其他平台 JSON；未观察到可靠有效期 |
| 查询/推进 | `POST /oauth2/login_with_qr`，表单合并 challenge 参数及 `code`、`exclusiveCorpId`、`stayLogin` | code 在这一步来自扫描链接；组织约束来自 bootstrap，stayLogin 使用网页默认 false |
| 已确认的业务分支 | QRListener 比较字符串 `11021`（等待）、`11041`（已扫码）、`11019`（过期）；`success:true` 进入 afterLogin | 等待响应已匿名实测，已扫码/过期来自官方脚本与模拟验证；不猜数字状态 |
| 后续交互 | afterLogin 的协议确认、改密、绑定、组织选择、授权等结构化字段 | 由官方脚本核实；需要时交给官方页面，不自动替用户选择企业或同意权限 |
| 完成认证 | `POST /oauth2/confirm_auth`，同一表单上下文，加 corpId、secondaryValidationResult、原 redirect_uri；响应 result.url 用于跳转 | 官方脚本核实；普通分支不选择企业，secondaryValidationResult 缺失时使用官方函数的空串默认 |
| 后台交接与身份 | 本次返回的 SSO 回调 → 后台 → `GET /baseInfo` | 回调由实际后台入口声明，身份接口沿用 Rovai 现有实现；手机确认后的网络链路尚未实测 |

`/user/qrcode/generate` 在这份官方脚本中用于 `onlineDevice` 设备验证分支，不是本次普通 OAuth 扫码初始化。
不采用其他应用的 bizScene/sceneId、不令 sceneId=client_id。`/login/login_with_qr` 和应用 registration
接口也不参与本次链路。未模拟或编造网页的设备识别、风控参数；服务端如要求额外交互，交给受控官方页面或明确失败。

## 已运行的匿名实测

独立 CookieJar 请求实际入口、初始化和一次查询：初始化 HTTP 200 且 success=true，返回完整链接；
查询约 5.3 秒返回 HTTP 200、success=false、errorCode=`11021`。这说明该查询可以有服务端等待语义，
不能在请求未结束时继续高频并发请求。

另外用生产 `ElectronDingTalkWebSession` 和原生 Electron net 请求层，在全新临时 userData、sessionData 和
Skill Library 中执行相同链路：preparing → awaiting_scan → 本地 PNG 生成，通过测试专用的 8 秒扫码期限退出。
未启动 Core、未借用日常 App 或外部浏览器 Session、未创建应用，也未保存账号。原始响应与临时凭据不进入仓库。

## 验证限制

自动测试验证协议输入、SSO 提交/回调、刷新与迟到响应、取消、独立期限、身份空名称、旧账号保护及迁移回滚；
本机 Electron UI fixture 验证本地 QR、sandbox 交互容器、暗色/亮色与缩放。模拟 SSO 或组织选择不等于真实扫码。

真实手机扫描确认、用户拒绝、组织选择、安全挑战、SSO 后 `/baseInfo`、重启恢复与 packaged App 的账号操作仍需
在隔离实例验收。本次匿名实测不能证明这些分支已通过，不能提升发布或 Stream 的既有能力门禁。
未知 bootstrap、字段、状态与跳转保持明确错误；协议漂移需要重新调查，不回退到 Canvas 或文案匹配。
