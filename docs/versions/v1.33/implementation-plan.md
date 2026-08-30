---
document_type: implementation-plan
version: v1.33
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-30
---

# v1.33 实施计划

## 仓库内实施

- [x] Migration 122/123/124/125、Data Contract `v1.38 / schema 79`、helper mode 数据保留、共享渠道 SQLite storage 与显式升级测试；
- [x] DingTalk account、Owner identity、publication intent、member Bot、per-App identity 和 provider-neutral directory；
- [x] Electron Main 直接 OAuth/Developer API：固定 endpoint、封闭 operation/argument、staged profile、超时/取消和 Renderer 秘密隔离；
- [x] 飞书/钉钉账号与 Developer Session 原子连接、publication credential 与 intent 原子推进、启动单次批量读取；
- [x] 删除 safeStorage/Keychain/独立 `.bin` 读取路径；旧文件只按严格名称 best-effort 清理，不迁移或解密；
- [x] 删除 DWS binary、版本/SHA、签名排除、打包资源、subprocess 生命周期与 stdout/stderr 协议；
- [x] 唯一浏览器 OAuth、staged 账号切换和 Core 失败时的内存丢弃；完整删除设备授权 UI/参数/endpoint/轮询；
- [x] 原 schema-1 Profile 重启复用、串行静默续期、临时失败保留、轮换保存重试与迟到检查 fence；
- [x] 每队员单 App publication 状态机、App identity freeze、头像、Robot、权限、版本、审批和恢复；
- [x] 每 App Stream、Robot/Card callback fast ACK、身份规范化和 topic fail-closed；
- [x] Owner-only 私聊/普通群、精确 `/new`、ExternalQuote、项目卡、单根 FIFO 与统一原子 admission；
- [x] 群 roster 与 Camp Membership reconcile、Core ChannelDelivery、AI 卡片、执行控制台安全投影和 Markdown 输出；
- [x] 设置页 Provider Tab、钉钉连接/发布/审批/管理入口、Provider-local 诊断与双主题样式；
- [x] 单元测试覆盖 OAuth、Developer API、Session、Provisioner、Open API、Stream、Inbound、Migration、Core admission 和 Renderer；
- [x] 完成仓库全量 Rust、TypeScript、文档、UI detector 与 Desktop build 门禁并记录本次结果。

## 主线合并兼容

- [x] 合并 `main@27c6b16f` 的 File Preview 与 Availability-first Runtime；版本编号冲突按来源记录迁入 v1.32/v1.33；
- [x] 渠道 Host 随 Core authority generation 启停和恢复，旧启动/关闭并发不会留下重复连接；
- [x] 保留完整渠道 migration chain，并通过真实 ticket/copy migration 验证旧飞书 marker collision 与 Bot/账号保留；
- [x] ExternalQuote 保留普通 Camp 的不可跳转引用外观，同时消息正文继续支持主线文件预览入口。

## 飞书执行卡呈现回归

- [x] 按 [Feishu Channel v4](../../contracts/feishu-channel-v4.md) 实现真实 timeline、文字前 10 行、单条原生 command
  折叠和无二级标题的结果框；超过 20 行使用前 9 / 提示 / 后 10，先脱敏再截断，apply_patch 仅结构化文件变化；
- [x] 15-command、50-element 与序列化 UTF-8 字节预算分页，文字和后续首条 command 尽量同页；钉钉纯文本格式不变；
- [x] Migration 125 清理旧 view state，封存内容及 Blob reference；迟到 evidence/正文不改 sealed timeline，重启/旧数据
  copy migration 保留 App/message/sequence，完整 Blob 缺失 fail closed；
- [x] 分页复用 Owner/原 App/原消息/sealed sequence 授权，一次点击仅一次 updateCard，不发 upsert、不触发 pump；
- [x] 扩展现有卡片/Main 测试与 Core 生命周期 owner，覆盖安全输出、空结果、成功/失败/取消、分页/UTF-8 边界、
  长 Blob 恢复与不可变性；不新增重复 Rust fixture owner，既有 migration 准入矩阵继续覆盖所有受支持来源；
- [ ] 在实际飞书客户端验收新终态卡的展开/收起与多页往返；既有 sealed 卡不批量回填。

## 外部验收与生产门槛

- [ ] 完成生产浏览器 OAuth Client 安全分发或服务端 token broker 实现；不得以设备授权作为备用；
- [ ] 在真实钉钉租户证明连接不创建应用、连续发布不重复 OAuth、切换失败保留旧账号；
- [ ] 在隔离环境完成浏览器首次登录、重启/静默续期、授权撤销后重连、取消与断网恢复验收；
- [ ] 证明应用创建、头像、Robot、权限、显式审批、版本 release 与原 App 恢复；
- [ ] 证明每 App Stream 断线恢复、Owner 私聊、Owner 群 `@`、non-owner gate 和 `/new`；
- [ ] 证明项目卡投递/callback、执行卡 streaming/终态翻页、Markdown 永久输出与应用管理链接；
- [ ] 取得多 Bot canonical mentions、话题和 app-only 附件官方可行性证据后，另行决定是否解除对应 feature gate。

## Go / No-Go

仓库门禁通过只表示实现可构建和本地合同成立。生产 OAuth Client 未完成或任一真实租户关键链路未证实时，钉钉渠道仍是
`NO-GO`；不得用本地 mock、Developer API 本地响应或卡片实例创建替代远端收发证据。
