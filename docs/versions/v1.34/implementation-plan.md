---
document_type: implementation-plan
version: v1.34
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-30
---

# v1.34 实施计划

> 当前状态：钉钉已按 [DingTalk Channel v4](../../contracts/dingtalk-channel-v4.md) 接入 Web Session 发布。
> 同一测试应用的免审发布、产品只读恢复/头像上传/Stream 已通过隔离实测；Owner 入站/Core/群聊/卡片与 packaged
> 恢复尚未完成，钉钉整体仍为 NO-GO。早期 checkpoint 记录不再代表当前协议完成度，详见[研究记录](../../research/dingtalk-web-session-probe.md)。

## 仓库内实施

- [x] Migration 122/123/124/125、Data Contract `v1.38 / schema 79`、helper mode 数据保留、共享渠道 SQLite storage 与显式升级测试；
- [x] DingTalk account、Owner identity、publication intent、member Bot、per-App identity 和 provider-neutral directory；
- [x] Electron Main Web Session/Console API：固定 endpoint、封闭 operation/argument、staged Cookie jar、超时/取消和 Renderer 秘密隔离；
- [x] 飞书/钉钉账号与 Developer Session 原子连接、publication credential 与 intent 原子推进、启动单次批量读取；
- [x] 删除 safeStorage/Keychain/独立 `.bin` 读取路径；旧文件只按严格名称 best-effort 清理，不迁移或解密；
- [x] 删除 DWS binary、版本/SHA、签名排除、打包资源、subprocess 生命周期与 stdout/stderr 协议；
- [x] 唯一官方网页登录、staged 账号切换和 Core 失败时只丢弃新 jar；不依赖 OAuth Client、Device Flow 或第三方 Client Secret；
- [x] schema-2 Cookie 重启恢复、官方 SSO 续接、临时失败保留、轮换 CAS 保存重试与迟到检查 fence；旧 OAuth row 保留到显式重连成功；
- [x] 每队员单 App 状态机、创建中断 fence/已知 ID 保存失败恢复、现代凭据、console 头像、数字 Robot 字段、grouped scopes、Owner-only 冻结版本和审批；
- [x] 每 App Stream、Robot/Card callback fast ACK、身份规范化和 topic fail-closed；
- [x] Owner-only 私聊/普通群、精确 `/new`、ExternalQuote、项目卡、单根 FIFO 与统一原子 admission；
- [x] 群 roster 与 Camp Membership reconcile、Core ChannelDelivery、AI 卡片、执行控制台安全投影和 Markdown 输出；
- [x] 设置页 Provider Tab、钉钉连接/发布/审批/管理入口、Provider-local 诊断与双主题样式；
- [x] 单元测试覆盖 Console API wire、Web Session、Provisioner、Open API、Stream readiness/ACK、Inbound、Migration、Core admission 和 Renderer；
- [x] 完成仓库全量 Rust、TypeScript、文档、UI detector 与 Desktop build 门禁并记录本次结果。

## 主线合并兼容

- [x] 合并 `main@4e796bde` 的外部附件快照、Camp Detail Popover、局部启动 loading 与 Composer 输入修复；
  保留主线 v1.32，渠道历史/当前记录顺延为 v1.33/v1.34，不改模型确认或历史验收事实；
- [x] 合并 `main@27c6b16f` 的 File Preview 与 Availability-first Runtime；版本编号冲突按来源记录迁入 v1.32/v1.33；
- [x] 渠道 Host 随 Core authority generation 启停和恢复，旧启动/关闭并发不会留下重复连接；
- [x] 保留完整渠道 migration chain，并通过真实 ticket/copy migration 验证旧飞书 marker collision 与 Bot/账号保留；
- [x] ExternalQuote 保留普通 Camp 的不可跳转引用外观，同时消息正文继续支持主线文件预览入口。

## 飞书执行卡呈现回归

- [x] 按 [Feishu Channel v6](../../contracts/feishu-channel-v6.md) 实现总折叠内的真实 timeline、文字最多 10 行、单条原生
  command 折叠和无二级标题结果框；长结果前 9 / 提示 / 后 10，并限 4KiB，先脱敏再截断，apply_patch 仅结构化文件变化；
- [x] 15-command、50 个递归 element 与整卡 24,000 UTF-8 bytes 预算分页，文字和后续首条 command 尽量同页；
  首次终态总面板收起，任何翻页后展开，单条 command 仍收起；钉钉纯文本格式不变；
- [x] Migration 125 清理旧 view state，封存内容及 Blob reference；迟到 evidence/正文不改 sealed timeline，重启/旧数据
  copy migration 保留 App/message/sequence，完整 Blob 缺失 fail closed；
- [x] 分页复用 Owner/原 App/原消息/sealed sequence 授权，唯一更新放进同步 response card，不单独 PATCH、发 upsert 或触发 pump；
- [x] 正式卡和显式预览共用分页呈现及 2.5 秒响应预算，超时后不追加迟到卡片；SDK 按 event ID 去重，
  成功无 Toast，错误只返回安全 Toast；完全离线时由飞书处理，不增加云端服务；非 callback 更新仍检查业务码；
- [x] 通过真实 SDK WebSocket 帧和 ACK 编码验证 200-command 卡的 2→3→2→1 与末页往返，目标页随同步应答返回、
  无 pre-ACK PATCH；覆盖不同点击与相同 event 重投、非 Owner、超时与预览不可变性；
- [x] 扩展现有卡片/Main 测试与 Core 生命周期 owner，覆盖安全输出、空结果、成功/失败/取消、分页/UTF-8 边界、
  长 Blob 恢复与不可变性；不新增重复 Rust fixture owner，既有 migration 准入矩阵继续覆盖所有受支持来源；
- [ ] 在实际飞书客户端验收新终态卡的展开/收起与多页往返；既有 sealed 卡不批量回填。

## 飞书永久正文卡

- [x] 实际作者 Bot 新建无标题 Card 2.0；正文下方的接收对象行使用空格分隔原生 @，没有逗号、顿号、角色标签或 callback；
- [x] Core 以公共 MessageDelivery 顺序投影 A2A 对象，以 Structured Content 投影 Owner attention；移除飞书专用正文中的
  结构化 CurrentUserMention，但不改源消息、digest、普通字面 `@你`、Renderer 或 Agent Context；跨账号/不可用 Bot 不猜身份；
- [x] 从真实 `reply_to_camp_message_id` 投影同 Camp 直接父消息；卡片顶部显示静态作者/3 行、240 字符摘要，不回退到 Topic
  root，不嵌套引用、不额外 @；缺失/删除/越界显示不可用，无关系不显示；无需新增数据库字段；
- [x] 完整长正文按 24KB 预算拆成连续卡片，保留 Unicode/代码围栏，每片都使用原 Topic root；仅末片 @，稳定分片 UUID 覆盖
  飞书一小时内的部分发送重试；仅首片显示回复摘要；原 Outbox/附件顺序/失败边界保留；
- [x] 未发送旧 delivery 在 claim 内升级，已有投影重试不重算；已发历史不回填，钉钉输出保持不变；
- [ ] 授权安装新构建后，在真实 Camp → Core Outbox → 飞书链路验收正文、真实回复摘要、A2A/Owner footer 和超长卡片；
  此前同一话题的双样式预览仅证明原生 mention 和布局可行。

## 外部验收与生产门槛

- [x] Web Session 路径不需要生产 OAuth Client 或 token broker；不再作为本版本阻塞项，不保留设备授权备用；
- [x] 在用户授权的测试组织证明连接后应用数不变，显式创建后只有一个普通内部应用；无需重新扫码即可配置/发布；
- [x] 隔离 Electron 首次扫码、完整进程重启恢复 Cookie，以及仅缺失 console access_token 时由官方 SSO 续接；
- [x] 同一应用的凭据、头像、Bot、四项最小权限、Owner-only 1.0.0 免审发布与冻结版本读回；产品 completed 只读恢复零 mutation；
- [x] 编译后的产品 PNG multipart 上传与真实 Stream connected readiness；OpenAPI Owner 私聊请求接受、AI 卡片实例创建；
- [ ] 真实撤销/取消/断网矩阵、账号切换失败、需要显式审批的组织和 packaged App/Core 重启恢复；
- [ ] 证明每 App Stream 断线恢复、Owner 私聊、Owner 群 `@`、non-owner gate 和 `/new`；
- [ ] 证明项目卡投递/callback、执行卡 streaming/终态翻页、Markdown 永久输出与应用管理链接；
- [ ] 取得多 Bot canonical mentions、话题和 app-only 附件官方可行性证据后，另行决定是否解除对应 feature gate。

## Go / No-Go

仓库门禁通过只表示实现可构建和本地合同成立。任一真实租户关键链路未证实时，钉钉渠道仍是
`NO-GO`；不得用本地 mock、Developer API 本地响应或卡片实例创建替代远端收发证据。

## 2026-08-30 主线合并验证

本次合入 `main@4e796bde`，以新的 v1.34 路由执行验证：

- `pnpm typecheck`、`pnpm test` 通过：123 个 Vitest 文件 / 1041 项；Node suite 220 通过，1 项 Windows 专属检查跳过；
- `pnpm test:rust:staged` 按多 target 路由执行 `cargo test --workspace`：Library 438、CLI 32、Core 182 通过，
  4 项既有显式 ignore 保留；不代表 slow/all-features 或真实 Runtime 验收；
- `pnpm test:composer-input`、`pnpm test:startup-presentation` 在隔离 Electron 夹具中通过；
- 文档版本、决定、链接检查及 `DOCS_BASE_REF=4e796bde pnpm docs:check:ci` 通过；
- `cargo fmt --all --check` 通过；仅对钉钉 checkpoint 的 Cookie 校验与既有测试执行 rustfmt，不改变语义；
- 惠的 200-command 混排预览已由飞书创建并回读，14 页，同 UUID 重放返回同一条消息；这不替代实际 callback 往返验收。

上述是主线合并时的证据快照；钉钉后续进展见下一节，不因主线合并或打包自动转为已验收。

## 2026-08-30 钉钉 Web Session 发布接入

- `pnpm typecheck` 与全量 `vitest run` 通过：123 个文件 / 1109 项，包含同 worktree 的飞书回归；
- `pnpm build:desktop`、`pnpm docs:test`（9 项）、`pnpm docs:check` 与 `DOCS_BASE_REF=4e796bde pnpm docs:check:ci` 通过；
- DingTalk 定向回归覆盖控制台 payload、同应用恢复、创建/版本 checkpoint、Owner-only scope、PNG、void success 与 Stream 假成功/迟到连接；
- 隔离远端证据见[研究记录](../../research/dingtalk-web-session-probe.md)。没有新增第二个测试应用，也没有更换其冻结版本；
- 本轮无 Rust 产品变更，不把此前 Rust 或 packaged 结果当作本轮新增实测；没有提交、推送、打包、安装或重启日常 App。
