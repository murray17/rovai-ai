---
document_type: implementation-plan
version: v1.30
authority: implementation-and-acceptance-status
status: completed
last_updated: 2026-08-27
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
  配置/发布/回读、普通发布无 Renderer QR/飞书确认页、独立 Compat Provisioner、持久 publication intent、
  release 错误后的 published read-back、unknown remote 防重复、冻结 App 显式核对接管和多 WebSocket Host/启动恢复；
- [x] 完成 p2p/group/topic identity、显式 mention gate、多 Bot collecting/finalize/timeout/mismatch；
- [x] 完成 ChannelTurnRequest 单根 FIFO、统一原子 admission、永久失败/Runtime deferred 与 queue card 更新；
- [x] 完成 ExternalQuote structured segment、`replyTo=null`、ExternalPrincipal source 与 CURRENT_INPUT v22；
- [x] 完成父群 authoritative roster、普通群完整 membership、话题按需 membership 与 disable reconciliation；
- [x] 完成 ChannelDelivery Outbox、实际作者 Bot、原生 Principal mention、lease/retry/attention 和恢复；
- [x] 完成 Preload/Renderer typed API、真实账号投影、账号 QR/兼容确认边界、普通 Provisioning Dialog 与
  Rovai 双主题 Bot/Project/Conversation surface；
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
- 连接不调用任何 App 创建接口或写入 App credential；普通发布不产生 QR/飞书确认页，registration 兼容模式只能
  显式选择；
- identity 漂移、Session 失效与未知远端状态全部 fail closed，不能静默创建第二个 App；
- 自动化只证明本地状态机和网络边界，不把未执行的真实租户外部效果写成通过。

## 验证证据

本地仓库门禁：

- `cargo fmt --all -- --check`；
- `cargo check --workspace --all-targets`；
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`；
- `cargo test -p rovai-core --lib`；
- `cargo test -p rovai-core --bin rovai`；
- `cargo test -p rovai-core --bin rovai-core`；
- Migration 114 upgrade、Developer Identity/publication intent、Channel 状态机、ExternalQuote、Context bytes 与
  Secret projection 定向测试全部通过；
- `pnpm typecheck`；
- `pnpm test`；
- `pnpm build:desktop`；
- `DOCS_BASE_REF=f588c773c2652a9e78887a31d17de8ed37524bb0 pnpm docs:check:ci`。

隔离 Desktop 验收使用独立临时 userData 和 `pnpm dev`：

- 1440、860、720 三档宽度均无横向溢出；720 下连接区与队员表按既有响应式规则折行；
- Porcelain Day 与 Steel Night 的层级、颜色、边界、头像和 disabled 状态均与当前 Rovai 设置页一致；
- 键盘焦点从“登录开放平台”按 Tab 依次跳过 disabled Bot/重复 Quick Chat，进入“添加项目目录”“重命名”“归档”，
  Shift+Tab 可逆；
- Quick Chat 首次登记生成一个 ProjectBinding；重复入口变为 `Quick Chat 已添加` disabled 状态，Core 唯一约束仍
  保持 fail closed；
- Renderer snapshot 与 Preload 不包含 Secret、credential ref、transport conversation 或 pending aggregate。

真实飞书租户的“连接前后 App 数量不变、普通发布只展示 Rovai 进度且不出现飞书创建确认页、连续发布两名队员均不
重新扫码、Session 失效不建未知 App、切换账号后旧 Bot 继续运行”和消息收发属于发布环境验收，仍需主人持有可用
企业权限；本地自动化没有把这些外部效果伪造为通过。
