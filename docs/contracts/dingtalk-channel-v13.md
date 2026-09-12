---
document_type: protocol-contract
contract: dingtalk-channel-v13
authority: dingtalk-developer-login-protocol-and-identity
status: accepted
version: 13
source_version: v1.58
last_updated: 2026-09-12
---

# DingTalk Channel v13

继承 [v12](dingtalk-channel-v12.md) 的渠道、Bot、Owner、发布与 Renderer 管理能力。本版替换开发者账号扫码机制，
不创建应用、不引入 Rovai OAuth Client、loopback 回调或应用注册接口。

## 登录与会话边界

Main 为每次连接管理 attemptId、generation、独立 AbortController、非持久 Session、后台认证参数和期限。
从 `https://open-dev.dingtalk.com/` 的本次重定向获得认证上下文；保留完整 client_id、redirect_uri、scope 与关联参数。
回调必须是后台声明的 `open-dev.dingtalk.com/dingtalk_sso_call_back`，既有 continue 等参数不可替换。

当前已确认的协议、官方脚本来源与实测范围见[协议调查](../research/dingtalk-login-protocol.md)。候选设备认证或应用注册端点
不得成为普通开发者登录的隐式后备。内部协议存在漂移风险，未知状态、未知 bootstrap 或不受支持的跳转明确失败。

登录适配器负责二维码请求、完整 payload 验证、结构化状态解析与认证提交；登录 Transport 负责自己的 Origin、Referer、
表单、每跳 HTTPS/主机/路径检查、响应限制和取消。不能复用后台专属 access_token/CSRF 请求头。
Cookie 由同一个 Session 按目标域选择，不手工跨域复制 Cookie 或凭据头。

Main 本地生成 PNG；Renderer 只得到图像、期限和进度，不得到票据、授权码、Cookie、CSRF 或原始响应。
无服务端有效期时 `expiresAt=null`；本地等待期限不得称为二维码有效期。
Dialog 不展示本地截止时间。
查询串行执行：前一个请求和正文完成后再等待间隔；不叠加并发请求。只在结构化信号明确时显示已扫码。

允许 preparing → awaiting_scan → scan_confirmed → completing_login → inspecting_identity，跳过没有观察到的中间阶段。
`onQrReady` 只更新图像；完成扫码后不因迟到图片而倒退。过期 generation 停止查询；刷新创建新 Session 与 generation，
旧请求只能影响已丢弃的临时 Session。每个异步步骤返回后检查取消与当前 generation。

额外交互由可信结构化字段触发，同一 Session 的 sandbox `DingTalkLoginView` 嵌入 Dialog；不自动选企业、同意权限，
不导出 Canvas 或匹配文案/CSS。返回后台后仍须通过身份接口验证，不凭页面显示“成功”或收到授权码宣布已连接。
特殊企业认证不能通过任意放宽跳转域名解决。

## 期限、身份与提交

单请求默认 20 秒，覆盖响应头与正文；扫码等待 5 分钟；自动 SSO 交接 30 秒；身份确认 20 秒、至多 3 次请求；
整次连接 10 分钟。各阶段期限与整体独立取消信号组合，Cookie 操作、正文读取或原生页面阻塞也必须及时结算。
提交前的本地等待、请求或阶段超时由 Main 正常返回 `awaiting_refresh`：结束旧请求并保留 Dialog，用户点击原二维码区域
才开启新的 attempt；不抛出扫码超时错误、不自动关闭或自动刷新。已确认的 `expired` 不因总期限到达而丢失其刷新入口。
结束后的迟到阶段/图片回调不得改变保留的状态或新尝试；旧流程的 finally 也不得清掉新 attempt。
本地保存前取消使 pending 失效，清理临时资源并保留旧账号；saving_local_session 继续锁定普通取消。

`/baseInfo` 仍是身份真源：corpId 与 staffId 必须是有效字符串，staffId 归一为 userId，不使用昵称、手机号、SSO UID 或旧身份补齐。
在第一个身份请求和 Cookie 交接之前投影 inspecting_identity。Cookie 中 access_token 与 `_csrf_token_` 仍只在 Main 解码一次，
交给 URL 参数/请求头编码；禁止把含凭据的完整 URL、响应正文或远端错误消息放进日志。

orgName/corpName 与 nick/name 分别取第一个去掉首尾空白后的有效展示字符串。名称可以为空：Main 与 Core 的 userName、corpName
使用 `string | null`，旧缺失 JSON 字段按空处理；Renderer 的 ChannelAccountView.userName、tenantName 同样可空。
“钉钉用户”“当前企业”仅是 Renderer 占位，不写入身份、账号或 Owner 绑定。企业与用户匹配校验不放宽。
`ChannelSettingsSnapshot.schemaVersion=4` 保持；Main、共享契约与同包 Renderer 同步处理可空名称和既有 completing_login 阶段。

Migration 150 从 `v1.57/schema 99` 升级到 `v1.58/schema 100`，仅允许 dingtalk_account 的 user_name、corp_name 为 NULL，
保留身份约束、索引、触发器、现有账号与 Bot/Owner 关系；回执写入失败时整笔回滚。Cookie schema 2 与凭据存储边界不变。

提交顺序继续为身份和 pending Session → `channels.dingtalk.account.commitConnection` 原子提交 → activatePendingLogin → connected。
只有明确认证失效或身份漂移才过期旧会话；网络失败、解析失败、服务暂不可用或名称缺失不能删除旧 Session。
后续管理既有应用仍校验它冻结的企业与用户身份。

## 验证

协议与 Transport 测试拥有字段、编码、重定向、未知状态、超长响应、请求/正文超时的输入矩阵；Web Session 测试拥有串行状态、
刷新、取消、有限身份重试与阶段期限；Main/Core/Renderer 验证 pending 提交、身份空名、占位、保存取消保护和数据迁移回滚。
官方匿名初始化的网络 Probe、模拟 SSO、真实手机确认与租户交互是不同证据，不能互相替代。
