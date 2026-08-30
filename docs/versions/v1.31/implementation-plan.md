---
document_type: implementation-plan
version: v1.31
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-30
---

# v1.31 实施计划

## 仓库内实施

- [x] Migration 122/123/124、Data Contract `v1.37 / schema 78`、helper mode 数据保留、共享渠道 SQLite storage 与显式升级测试；
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
