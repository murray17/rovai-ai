---
document_type: protocol-contract
contract: feishu-channel-v16
authority: feishu-channel-account-provisioning-admission-delivery
status: accepted
version: 16
source_version: v1.58
last_updated: 2026-09-12
---

# Feishu Channel v16 Contract

继承 [v15](feishu-channel-v15.md) 的 Bot、Owner、入站、执行卡、发布与投递合同。本版替换开发者账号扫码、
恢复和控制台 bootstrap 的浏览器执行机制。账号与 Developer Session 的 Core 原子提交、revision CAS 和已发布
Bot 的独立生命周期继续遵守 [Channel Storage v3](channel-storage-v3.md)。无数据库 Migration。

## 1. 登录上下文与协议适配

每次扫码创建独立 attemptId、generation、AbortController、非持久 Electron Session、flowKey、token、阶段和总截止时间。
初始化、轮询、会话交接、门户和登录后 API 都经同一请求层使用显式绑定该 Session 的 Chromium 网络请求；不得切换到默认 Session 或另一个 HTTP Cookie jar。
重新扫码废止旧 attempt；每次异步返回后，必须重检当前 attempt/generation 和取消状态，再通知 UI 或设置 pending session。

`FeishuLoginProtocol` 拥有 Web 登录域、开放平台入口、redirectUri、Passport 应用标识及请求头。当前默认配置是
`accounts.feishu.cn`、`https://open.feishu.cn/app?lang=zh-CN`、Passport app ID `7`、API version `1.0.0`、
`x-device-info: platform=websdk`、`x-terminal-type: 2`。该应用标识不能用用户创建的 Bot AppID 替代。
Web 端点不是官方公开的长期稳定 API；协议变化必须明确失败，不回退隐藏窗口、图片差异或文字匹配。

- `POST /accounts/qrlogin/init` 的 JSON 为 `{biz_type:null, redirect_uri:profile.redirectUri}`。
  HTTP 成功且业务 code 为数值或字符串零后，要求 `data.step_info.token` 与响应头 `x-flow-key` 都为非空字符串；
  缺失时返回 `feishu_login_protocol_incomplete`，不得进入空轮询。
- 主进程用 `{qrlogin:{token}}` 的 JSON 字符串生成 PNG data URL，`onQrReady` 只传图片、服务端有效期（若已证明）
  与本地等待截止时间。不向 Renderer 下发 flowKey、Cookie、CSRF 或单独的二维码 token。
- `POST /accounts/qrlogin/polling` 携带同一 `x-flow-key` 和 `{biz_type:null}`。请求串行执行，上次完成后才等待下次，
  默认间隔 1500ms。

| 结构化信号 | 行为 |
| --- | --- |
| `next_step=qr_login_polling, step_info.status=1` | 待扫码，继续查询 |
| `next_step=qr_login_polling, step_info.status=2` | 已扫码，等待手机确认；重复响应不倒退 |
| `step_info.status=5` | `expired`，清理本次尝试，允许重新扫码 |
| `next_step=enter_app` | 立即进入会话建立；不要求先看到 status 2 |
| 已知账号选择、授权或验证步骤 | 返回对应的额外交互提示，停止自动流程 |
| 未知步骤、状态或响应格式 | 明确的适配错误，不无限等待 |

当前真实初始化响应未提供明确有效期，因此 `expiresAt=null`；`waitUntil` 只保留为兼容元数据，Dialog 不显示本地截止时间。
收到 `status=5` 后，由 Main 投影 `expired`；Renderer 在原二维码区域呈现可点击的刷新按钮，不继续显示旧码，
也不依据本地等待截止时间推断服务端过期。

## 2. 请求与可信地址

统一 HTTP 层使用手动重定向并自行返回 `finalUrl`，不依赖 Electron `Response.url`。
当前 Electron `ses.fetch({redirect:'manual'})` 在跳转时直接取消，无法交付手动跳转响应；因此传输层使用
`net.request({session, credentials:'include', useSessionCookies:true, redirect:'manual'})` 捕获 redirect event，
先结束原请求，再让策略层校验并创建下一跳。全部请求沿用同一 Session，不另建 HTTP 客户端 Cookie jar。
只接受 HTTPS、无用户名密码、默认端口的精确可信地址：

- 登录/交接：`accounts` 与 `passport` 的 `feishu.cn`、`larkoffice.com`、`larksuite.com` 主机；
- 开放平台：`open.feishu.cn`、`open.larkoffice.com`、`open.larksuite.com`；
- 可保存 Cookie 域：上述三个根域及其子域。Cookie 域准入不等于网络请求主机准入。

每个 Location 在发出下一跳前校验，最多八次跳转。登录协议 POST 不自动跳转重放；API mutation 遇到可信重定向返回
原状态供 API adapter 分类，不自动重放。导航只发送 GET 和通用 Accept，不复制调用方的登录头、Cookie header、CSRF、
Authorization 或请求正文；Cookie 由 Session 按目标域与路径选择。

最终开放平台 origin 同时决定 API、referer、origin 和 CSRF 来源；若 HTML 声明的 `outDomain.larkOpen` 与最终站点
不一致则拒绝。管理 API 只允许该 origin 下的 `/developers/` 路径。品牌按精确主机映射：`open.feishu.cn` 与
`open.larkoffice.com` 为 `feishu`，`open.larksuite.com` 为 `lark`；不得用包含 `lark` 的字符串猜品牌。

HTTP 单请求默认 15 秒，包括重定向与响应正文读取。扫码等待默认 5 分钟、自动会话交接 30 秒、身份读取 20 秒，
整个自动登录默认 10 分钟；各阶段与总期限由独立定时器驱动取消，不能依赖轮询检查。
取消同时结束 fetch、正文读取和轮询等待；无响应或不配合取消的 Promise 也不能阻止本地终止。HTTP 层缓冲有界正文，
不将未受期限保护的远端正文流交给后续调用者。当前不自动重试远端登录步骤；配置可调整等待策略，不能把本地超时映射成二维码过期。

## 3. 被动 bootstrap 与身份归一化

跨域交接 URI 为非空字符串时先验证再访问，随后请求开放平台页面。该可选字段省略、为 `null` 或仅含空白的字符串时，
直接用本次 Session 请求开放平台；非字符串值仍返回协议错误。只有可信站点的完整身份与 CSRF bootstrap 成功解析，
才能生成待提交会话；扫码、Cookie 存在或 HTTP 200 均不能单独证明连接成功。

HTML 用 HTML parser 提取 inline script，再用 JS parser 读取已知 `window.user`、`window.csrfToken`、
`window.outDomain` 的数据字面量（含常见无参 IIFE 包装和字面量 `JSON.parse`）。不创建浏览器、不执行远端脚本、
不使用 eval/new Function，不从文本、画布或 DOM 图片变化推断认证。不能静态取得完整 bootstrap 时明确失败；
需要额外交互的登录落点给出提示，不重试渲染页面。

首次登录、恢复本地身份、在线检查和管理操作共用以下归一化顺序；每个候选必须是去除首尾空白后的非空字符串：

| 字段 | 候选顺序 |
| --- | --- |
| userId | id → userId → user_id |
| userName | name → userName → user_name → displayName.value |
| tenantId | tenantId → tenant_id |
| tenantName | tenantDisplayName.value → tenantName → tenant_name |
| email | email，可选 |

任一必需字段的所有候选均无效时，立即报身份不完整并仅记录缺失字段名。不得用名称、email 或旧会话 ID 补齐 ID；
不限制展示名称的语言或字符，不严格验证无关字段。同账号/企业判断继续使用 brand + userId + tenantId；名称与
email 变化不构成切换。在线检查保留 valid/invalid/unavailable 三态；暂时的请求、解析或本地保存异常不清理旧连接。

`StoredFeishuDeveloperSession` 增加可选 `portalOrigin`，恢复时按保存品牌校验；旧记录按 brand 选择门户。
Cookie 持久化保留 domain、path、expirationDate、secure、httpOnly、sameSite、session 和可选 hostOnly。
旧记录通过 Chromium domain 的前导点识别 host-only；不把 host-only cookie 扩成整个父域。
Core 的 Session JSON 准入同步接受 `cookies` 与可选 `portalOrigin`，保留仅含 `cookies` 的旧记录读取。
`portalOrigin` 只接受与 identity brand 匹配的三个精确 HTTPS 开放平台 origin，拒绝路径、凭据、相似域和其他 Session 字段；
Cookie 域与 Main 保持一致，接受 `feishu.cn`、`larkoffice.com`、`larksuite.com` 及各自子域。

## 4. 主进程状态与本地提交

正常阶段为 `loading_local_session → preparing → awaiting_scan → scan_confirmed → completing_login →
inspecting_identity → saving_local_session → connected`。允许跳过未观察到的阶段，单次尝试不可倒退。
`onQrReady` 只修改二维码内容；扫码确认后清除旧图与倒计时。Renderer 仅显示 Main 投影。

继续采用 `pendingConnection → channels.feishu.account.commitConnection → activatePendingLogin`。
在本地事务开始前失败或取消仅清理新 attempt，原账号与 Cookie 保留。只有本地提交成功且内存会话激活完成，
才关闭 Dialog 和显示新连接成功。Core 已提交而内存激活尚未完成时，连接投影仍保留原账号或未连接状态。

事务开始后 Main/Renderer 都禁止取消、断开和重复连接。每个事务使用固定 commandId；丢失回执时最多立即重放一次
同一命令读取既有结果，不生成新 commandId。明确 rejected 才丢弃 pending；结果仍不明确则保留 pending 和
`saving_local_session`，投影可选 `commitUncertain=true`，提供“核对保存结果”。后续核对/状态刷新仍复用该命令；
已取得 applied 回执时只继续激活，不重新提交。进程重启后以 Core 已持久记录恢复，不假定网络错误等于未提交。

`ChannelQrAttemptView` 包含 `completing_login`、`awaiting_refresh` 和可选 `waitUntil`、`commitUncertain`，其余字段与
`ChannelSettingsSnapshot.schemaVersion=4` 保持。`channels.refreshLoginQr(attemptId)` 对过期飞书 attempt 创建新尝试，
对结果不明的本地提交核对原命令；钉钉遵循其当前渠道合同。用户普通取消仍为 quiet no-op。

本地登录、请求或阶段超时先结束旧请求并清理临时会话，再进入 `awaiting_refresh`，保留 Dialog 与二维码区域的刷新按钮。
不显示扫码超时报错，不自动关闭或重新生成；只有用户点击刷新才创建新 attempt。渠道确认过期使用独立的 `expired`。
这两种可刷新结果由 Main 正常返回，不成为 IPC 拒绝或页面 alert；其他网络、协议与身份错误仍明确报告。
该恢复规则只适用于本地提交前，不能绕过 `saving_local_session` 的取消和重复连接保护。

错误分别覆盖二维码过期、本地总期限、请求/正文超时、网络错误、服务端拒绝、协议变化、额外交互、身份/CSRF
解析不全及本地拒绝。日志白名单为 attemptId、阶段、请求耗时、HTTP 状态、业务错误码、已脱敏的域/路径和缺失字段名；
不包含 Cookie、二维码 token、flowKey、CSRF、个人信息、认证查询参数或远端原始错误文本。

## 5. 验证边界

自动测试覆盖阶段跳过和单调性、串行轮询、响应头/正文超时、独立总期限、取消和迟到结果隔离、可信重定向、
三站点品牌与恢复、字段别名和安全 HTML 提取、原账号保留、提交丢回执及禁止提交中取消。
真实 Electron 夹具验证 Session HTTP/被动 bootstrap、Cookie 恢复与管理请求、主流程没有登录窗口、生产 QR Dialog 的
日夜主题和键盘交互。匿名真实 init/poll probe 仅证明端点和待扫码响应兼容，不代替真人扫码、身份交接、实际存储或 Bot 发布验收。
