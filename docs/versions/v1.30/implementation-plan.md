---
document_type: implementation-plan
version: v1.30
authority: implementation-and-acceptance-status
status: completed
last_updated: 2026-08-29
---

# v1.30 实施计划

## 实施步骤

- [x] 从固定 revision `f588c773c2652a9e78887a31d17de8ed37524bb0` 建立独立 worktree，并先提交 Rovai
  风格的渠道设置 foundation；
- [x] 完成 Migration 113 与 ExternalPrincipal author/Context 22 pairing；完成 Migration 114/115，以及 Migration 116、
  Data Contract v1.28/schema 69、真实 Developer Identity、publication intent、Owner identity 与 PendingCampBinding；
- [x] 以 existing directory Camp 投影 Project Catalog，删除 Channel 人工 ProjectBinding/bind/switch；完成 DM Quick Chat
  generation、私聊限定 `/new`、群/话题 immutable project Camp 与 frozen pending-message FIFO；
- [x] 删除 controller App 账号模型；完成 Developer Web Session、真实 user/tenant 回读、safeStorage Cookie jar、
  identity drift/expiry fail-closed、切换账号的临时 Session/成功后替换/失败保留旧登录态，以及断开不删除 Bot credential；
- [x] 完成 Web Session MemberBotProvisioner、Session cookie/CSRF console bootstrap、OpenPlatformApiClient 创建/
  配置/发布/回读、发布无 Renderer QR/飞书确认页、旧 registration Provisioner/确认窗口/API 全量退役、持久 publication intent、
  release 错误后的 published read-back、unknown remote 防重复、冻结 App 显式核对接管和多 WebSocket Host/启动恢复；
- [x] 把首次创建收敛为固定模板优先、仅明确 non-creation rejection 才 self-build fallback；以
  `publicationIntentId` correlation，并在任何后续 mutation 前 await Core App-ID durable barrier；
- [x] 先启用 Bot 并发布/复用 `1.0.0` activation，再由唯一配置入口并行读取 Scope/Event/Callback/Manifest、按确定顺序
  提交全部 mutation，并在一个 120 秒 deadline 中逐轮并行回读；Manifest 最多读写一次，同次 final verify 复用可信
  convergence state，按真实 mutation 决定是否发布下一 patch，并在 crash/retry 中复用已存在版本；
- [x] 只有无可信 App ID 的 create outcome unknown 进入 `failed_unknown_remote_state`；冻结 App 的 Event/Scope/Version/
  credential/连接失败进入 `failed_recoverable`，在线配置核验与真正 WebSocket connect 分离为八阶段进度；
- [x] 普通发布解析并上传 exact 队员受控头像；无引用才回退 Rovai icon，冻结 `1.0.0` App 可在显式核对中发布幂等
  `1.0.1` 头像修复版本且不创建第二个 App；
- [x] 把消息权限、Event 与 Callback readiness 从 Manifest 自证切到开放平台在线 API：补齐 P2P/group-at scopes、
  `eventMode=4`、receive/roster events、发布后在线回读和同一冻结 App 的下一 patch 修复；
- [x] 增加脱敏的 WebSocket、SDK policy、message normalized 与 handler accepted/rejected 分层诊断；SDK 无归一化前
  raw hook 时不伪造 raw-event 日志；
- [x] Core publication 状态机永久冻结每名队员的 App ID；完成后重复发布拒绝，历史 disabled 与凭据恢复只重开同一 intent、
  核对同一 App，不存在换绑或第二次创建；
- [x] 完成 p2p/group/topic identity、显式 mention gate、多 Bot collecting/finalize/timeout/mismatch；
- [x] 完成 Owner verify/per-App identity 自动映射 gate、non-owner 零业务事实、canonical-first acknowledgement App、单张
  原会话项目卡和 callback envelope/external message ID/nonce/version/CAS 重放防护；Non-owner 只收到私有 toast，成功后
  Core 先消费再 durable recall，项目失效轮换卡片 authority，旧 private picker 在 Host tick 中失权、撤回并重发；Developer Session `tenantId` 与 event `tenant_key`
  分开处理，发布期先冻结 `(app_id, owner_open_id digest)`，首条匹配的 Owner 事件再冻结 event tenant key；
  该内部映射不投影为 Owner 待处理的 Renderer 状态；
- [x] 实测确认飞书个人版入站可只携带 `open_id + union_id`；发布/同 App reconciliation 用各 App credential
  调用 Application v6 get，以 `user_id_type=open_id` 读取当前 App 不可变 `creator_id`，作为该 App 的
  `ownerOpenId` 随 Bot binding 原子冻结并以 `(app_id, open_id)` 稳定判断；复用 App 自管理权限而不要求
  Contact scope 或通讯录读取，只持久化摘要；解析失败不完成发布，入站显示连接异常而非 non-owner；
- [x] 完成 ChannelTurnRequest 单根 FIFO、统一原子 admission、永久失败/Runtime deferred 与 queue card 更新；
- [x] 完成 ExternalQuote structured segment、`replyTo=null`、ExternalPrincipal source 与 CURRENT_INPUT v22；
- [x] 完成父群 authoritative roster、普通群完整 membership、话题按需 membership 与 remove reconciliation；
- [x] 完成 ChannelDelivery Outbox、实际作者 Bot、原生 Principal mention、lease/retry/attention 和恢复；
- [x] 用 Core-owned per-AgentRun execution console 替换用户可见 `agent_status/completion`；Main 与 Renderer 共享公开
  Evidence presentation，下一条 root admission 由原 App durable recall 旧控制台；
- [x] 把正式 Agent 输出改为无标题永久 Markdown，并将公开 CampMessage 的 Managed Attachment v2 图片/文件按正文后
  ordinal 原生投递、独立重试和失败 attention 收口；
- [x] 完成 Preload/Renderer typed API、真实账号投影、唯一账号 QR、Provisioning Dialog、按绑定 brand 的官方应用详情
  链接与 Rovai 双主题 Bot surface；移除 Project/Conversation、管理和停用命令，只保留安静诊断计数；
- [x] 完成当前 Architecture、Contracts、UI、Version Decision、Context change 与导航；
- [x] 运行完整 Rust、TypeScript、文档、Clippy、Desktop build 与 Migration 门禁；
- [x] 使用隔离 userData 验收渠道设置日/夜主题、键盘、窄窗口和秘密不进入 Renderer；
- [x] 提交最终实现并记录验证证据；最终 commit identity 由本分支 Git history 固化。

## 验收原则

- Feishu Owner 的 ExternalPrincipal 永远不等于 local owner；non-owner 在 observation 前停止且没有业务事实；
- DM 自动 Quick Chat，`/new` 只支持 Owner 私聊且不进入模型；未绑定群/话题、未 mention、聚合不完整或 roster 不完整
  都没有 CampMessage/Turn/Run 副作用；
- 项目卡只含 opaque project ID/可控显示名，并由完整 canonical mention 顺序中的第一个 Bot 唯一投递到原群或原 Topic；
  callback 只信 envelope identity 与 clicked message ID，Non-owner、旧卡、双击/重放不能改变 pending 或创建第二个 Camp；
  成功后 Core authority 先失效再异步撤回，项目失效只刷新卡片，不能消费 pending；
- 同一 Camp queued 请求在前一根 Turn 真正终结前不可进入公共会话；
- 飞书 reply 只形成当前消息的 ExternalQuote，不产生内部 reply 或第二条 CampMessage；
- 普通群 roster 与话题按需扩张都复用 Camp Membership v1 exact source generation；
- Secret 与 raw Feishu identity 不进入 Renderer/Agent；公开输出只来自 Core 已提交内容；
- 执行控制台不含 reasoning/thought，不能覆盖正式正文；永久正文与附件各有稳定 dedupe，单个附件失败不得重发正文或
  已成功附件；
- 连接不调用任何 App 创建接口或写入 App credential；发布不产生 QR/飞书确认页，registration 协议没有实现、API 或
  交互入口；
- identity 漂移、Session 失效、完成后重复发布、历史 disabled 恢复与未知远端状态全部 fail closed 或复用冻结 App，不能静默创建第二个 App；
- 模板 create 的 transport/408/409/429/5xx、code 0 缺 App ID 与 Session 失效都不得 fallback；Core App-ID freeze 未完成时
  不得读取 Secret、启用 Bot、配置或建版本；
- App ID 已冻结后的 Event timeout 必须可继续核对同一 App，不能仅因 credential 尚未写入而标成 unknown；
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
- Migration 116/119 upgrade、v118→v119 独立兼容、Developer Identity/publication intent、队员 App 身份冻结/历史 disabled 同 App reactivation、Owner-only Channel 状态机、发布期 App-scoped Owner prebinding、DM `/new`、PendingCampBinding、ExternalQuote、Context bytes 与
  Secret projection、内置/managed 头像解析、正常发布头像传递、冻结 App 头像/readiness 修复、Manifest 假阳性、P2P
  Scope ID 映射、template-first fallback matrix、durable barrier、activation-first、dynamic patch reuse、Event timeout
  recoverable、Event/Callback mode fail-closed、原会话 project picker/Non-owner toast/authoritative message ID/旧 private
  picker 恢复/durable recall、execution console 更新/消息身份、永久 Markdown、附件顺序/独立失败
  定向测试全部通过；
- `pnpm typecheck`；
- `pnpm test`；
- `pnpm build:desktop`；
- `DOCS_BASE_REF=fbd07e6a958a1d9a8d508413b4bbd548939bbd7d pnpm docs:check:ci`（本次原会话项目卡基线）。

隔离 Desktop 验收使用独立临时 userData 和 `pnpm dev`：

- 1440、860、720 三档宽度均无横向溢出；720 下连接区与队员表按既有响应式规则折行；
- Porcelain Day 与 Steel Night 的层级、颜色、边界、头像和不可用状态均与当前 Rovai 设置页一致；
- 键盘焦点从“登录开放平台”按 Tab 依次经过可用的发布/继续核对/“飞书管理”动作，Shift+Tab 可逆；
- 页面没有项目目录、会话绑定、Quick Chat 添加、重命名或归档入口；有异常时只显示 pending/error 诊断计数；
- Renderer snapshot 与 Preload 不包含 Secret、credential ref、transport conversation 或 pending aggregate。

真实飞书租户的“连接前后 App 数量不变、发布只展示八阶段 Rovai 进度且不出现飞书创建确认页、首次 activation 后
Event 能在 120 秒窗口内收敛、连续发布两名队员均不
重新扫码、已发布行跳转绑定 App 的官方详情页、Session 失效不建未知 App、切换账号后旧 Bot 继续运行，以及私聊进入
`channel.on('message')` 后按未绑定/已绑定路径响应”属于发布环境验收，仍需 Owner 持有可用
企业权限；还需实测 Owner 私聊自动 Quick Chat、私聊 `/new`、non-owner gate、群/话题原会话单张项目卡、callback
promotion 与成功撤回。本地自动化没有把这些外部效果伪造为通过。
