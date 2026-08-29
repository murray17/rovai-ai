---
document_type: implementation-plan
version: v1.31
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-29
---

# v1.31 实施计划

## 仓库内实施

- [x] Migration 122、Data Contract `v1.35 / schema 76` 与显式升级测试；
- [x] DingTalk account、Owner identity、publication intent、member Bot、per-App identity 和 provider-neutral directory；
- [x] 固定 DWS Gateway：版本/SHA、封闭命令与参数、无 Shell、隔离 profile、超时/取消和 Renderer 秘密隔离；
- [x] 浏览器 OAuth、设备授权 fallback、staged 账号切换和旧 Profile 回滚；
- [x] 每队员单 App publication 状态机、App identity freeze、头像、Robot、权限、版本、审批和恢复；
- [x] 每 App Stream、Robot/Card callback fast ACK、身份规范化和 topic fail-closed；
- [x] Owner-only 私聊/普通群、精确 `/new`、ExternalQuote、项目卡、单根 FIFO 与统一原子 admission；
- [x] 群 roster 与 Camp Membership reconcile、Core ChannelDelivery、AI 卡片、执行控制台安全投影和 Markdown 输出；
- [x] 设置页 Provider Tab、钉钉连接/发布/审批/管理入口、Provider-local 诊断与双主题样式；
- [x] 单元测试覆盖 DWS、Session、Provisioner、Open API、Stream、Inbound、Migration、Core admission 和 Renderer；
- [x] 完成仓库全量 Rust、TypeScript、文档、UI detector 与 Desktop build 门禁并记录本次结果。

## 外部验收与生产门槛

- [ ] 确认生产 Rovai OAuth Client 采用 public-client/device-flow 或服务端 token broker，并完成可安全分发实现；
- [ ] 在真实钉钉租户证明连接不创建应用、连续发布不重复 OAuth、切换失败保留旧账号；
- [ ] 证明应用创建、头像、Robot、权限、显式审批、版本 release 与原 App 恢复；
- [ ] 证明每 App Stream 断线恢复、Owner 私聊、Owner 群 `@`、non-owner gate 和 `/new`；
- [ ] 证明项目卡投递/callback、执行卡 streaming/终态翻页、Markdown 永久输出与应用管理链接；
- [ ] 取得多 Bot canonical mentions、话题和 app-only 附件官方可行性证据后，另行决定是否解除对应 feature gate。

## Go / No-Go

仓库门禁通过只表示实现可构建和本地合同成立。生产 OAuth Client 未完成或任一真实租户关键链路未证实时，钉钉渠道仍是
`NO-GO`；不得用本地 mock、DWS 成功退出码或卡片实例创建替代远端收发证据。
