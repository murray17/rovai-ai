---
document_type: implementation-plan
version: v1.30
authority: implementation-and-acceptance-status
status: completed
last_updated: 2026-08-28
---

# v1.30 实施计划

## 实施步骤

- [x] 从固定 revision `f588c773c2652a9e78887a31d17de8ed37524bb0` 建立独立 worktree，并先提交 Rovai
  风格的渠道设置 foundation；
- [x] 完成 Migration 113 与 ExternalPrincipal author/Context 22 pairing；完成 Migration 114、Data Contract
  v1.27/schema 68、真实 Developer Identity 和 publication intent；
- [x] 完成 owner-only ProjectBinding、会话 bind/switch、Camp workspace freeze 与未绑定 resend 边界；
- [x] 删除 controller App 账号模型；完成 Developer Web Session、真实 user/tenant 回读、safeStorage Cookie jar、
  identity drift/expiry fail-closed 与断开不删除 Bot credential；
- [x] 完成 Web Session MemberBotProvisioner、Session cookie/CSRF console bootstrap、OpenPlatformApiClient 创建/
  配置/发布/回读、发布无 Renderer QR/飞书确认页、旧 registration Provisioner/确认窗口/API 全量退役、持久 publication intent、
  release 错误后的 published read-back、unknown remote 防重复、冻结 App 显式核对接管和多 WebSocket Host/启动恢复；
- [x] 普通发布解析并上传 exact 队员受控头像；无引用才回退 Rovai icon，冻结 `1.0.0` App 可在显式核对中发布幂等
  `1.0.1` 头像修复版本且不创建第二个 App；
- [x] 把消息权限、Event 与 Callback readiness 从 Manifest 自证切到开放平台在线 API：补齐 P2P/group-at scopes、
  `eventMode=4`、receive/roster events、发布后在线回读和同一冻结 App 的下一 patch 修复；
- [x] 增加脱敏的 WebSocket、SDK policy、message normalized 与 handler accepted/rejected 分层诊断；SDK 无归一化前
  raw hook 时不伪造 raw-event 日志；
- [x] Core publication 状态机永久冻结每名队员的 App ID；完成后重复发布拒绝，历史 disabled 与凭据恢复只重开同一 intent、
  核对同一 App，不存在换绑或第二次创建；
- [x] 完成 p2p/group/topic identity、显式 mention gate、多 Bot collecting/finalize/timeout/mismatch；
- [x] 完成 ChannelTurnRequest 单根 FIFO、统一原子 admission、永久失败/Runtime deferred 与 queue card 更新；
- [x] 完成 ExternalQuote structured segment、`replyTo=null`、ExternalPrincipal source 与 CURRENT_INPUT v22；
- [x] 完成父群 authoritative roster、普通群完整 membership、话题按需 membership 与 remove reconciliation；
- [x] 完成 ChannelDelivery Outbox、实际作者 Bot、原生 Principal mention、lease/retry/attention 和恢复；
- [x] 完成 Preload/Renderer typed API、真实账号投影、唯一账号 QR、Provisioning Dialog、按绑定 brand 的官方应用详情
  链接与 Rovai 双主题 Bot/Project/Conversation surface；移除本机管理/停用命令；
- [x] 完成当前 Architecture、Contracts、UI、Version Decision、Context change 与导航；
- [x] 运行完整 Rust、TypeScript、文档、Clippy、Desktop build 与 Migration 门禁；
- [x] 使用隔离 userData 验收渠道设置日/夜主题、键盘、窄窗口和秘密不进入 Renderer；
- [x] 提交最终实现并记录验证证据；最终 commit identity 由本分支 Git history 固化。

## 验收原则

- ExternalPrincipal 永远不等于 local owner；只有主人能创建 ProjectBinding 和 bind/switch；
- 未绑定、未 mention、聚合不完整或 roster 不完整都没有 CampMessage/Turn/Run 副作用；
- 同一 Camp queued 请求在前一根 Turn 真正终结前不可进入公共会话；
- 飞书 reply 只形成当前消息的 ExternalQuote，不产生内部 reply 或第二条 CampMessage；
- 普通群 roster 与话题按需扩张都复用 Camp Membership v1 exact source generation；
- Secret 与 raw Feishu identity 不进入 Renderer/Agent；公开输出只来自 Core 已提交内容；
- 连接不调用任何 App 创建接口或写入 App credential；发布不产生 QR/飞书确认页，registration 协议没有实现、API 或
  交互入口；
- identity 漂移、Session 失效、完成后重复发布、历史 disabled 恢复与未知远端状态全部 fail closed 或复用冻结 App，不能静默创建第二个 App；
- Manifest、HTTP 200 与 WebSocket 握手都不能单独证明消息可达；critical scope、event subscription、长连接模式和
  published version 必须通过在线回读；
- 已发布 Bot 的本机动作只有跳转官方应用详情；Rovai 不声称可以停用或关闭远端 Bot；
- 自动化只证明本地状态机和网络边界，不把未执行的真实租户外部效果写成通过。

## 验证证据

本地仓库门禁：

- `cargo fmt --all -- --check`；
- `cargo check --workspace --all-targets`；
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`；
- `cargo test -p rovai-core --lib`；
- `cargo test -p rovai-core --bin rovai`；
- `cargo test -p rovai-core --bin rovai-core`；
- Migration 114 upgrade、Developer Identity/publication intent、队员 App 身份冻结/历史 disabled 同 App reactivation、Channel 状态机、ExternalQuote、Context bytes 与
  Secret projection、内置/managed 头像解析、正常发布头像传递、冻结 App 头像/readiness 修复、Manifest 假阳性、P2P
  Scope ID 映射和 Event/Callback mode fail-closed 定向测试全部通过；
- `pnpm typecheck`；
- `pnpm test`；
- `pnpm build:desktop`；
- `DOCS_BASE_REF=f588c773c2652a9e78887a31d17de8ed37524bb0 pnpm docs:check:ci`。

隔离 Desktop 验收使用独立临时 userData 和 `pnpm dev`：

- 1440、860、720 三档宽度均无横向溢出；720 下连接区与队员表按既有响应式规则折行；
- Porcelain Day 与 Steel Night 的层级、颜色、边界、头像和不可用状态均与当前 Rovai 设置页一致；
- 键盘焦点从“登录开放平台”按 Tab 依次经过可用的“飞书管理”链接并跳过不可用 Bot/重复 Quick Chat，进入“添加项目目录”“重命名”“归档”，
  Shift+Tab 可逆；
- Quick Chat 首次登记生成一个 ProjectBinding；重复入口变为 `Quick Chat 已添加` disabled 状态，Core 唯一约束仍
  保持 fail closed；
- Renderer snapshot 与 Preload 不包含 Secret、credential ref、transport conversation 或 pending aggregate。

真实飞书租户的“连接前后 App 数量不变、发布只展示 Rovai 进度且不出现飞书创建确认页、连续发布两名队员均不
重新扫码、已发布行跳转绑定 App 的官方详情页、Session 失效不建未知 App、切换账号后旧 Bot 继续运行，以及私聊进入
`channel.on('message')` 后按未绑定/已绑定路径响应”属于发布环境验收，仍需主人持有可用
企业权限；本地自动化没有把这些外部效果伪造为通过。
