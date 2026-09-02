---
document_type: implementation-plan
version: v1.38
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-02
---

# v1.38 实施与验收

## 当前交付

- [x] 渠道页只把飞书作为可管理 Provider。
- [x] 钉钉固定显示官方图标、置灰状态和“敬请期待”，使用原生 disabled/ARIA 语义，无 hover、点击或键盘动作。
- [x] 保存的钉钉账号、连接、Bot 和管理链接不从 Renderer 暴露；`selectedKind=dingtalk` 与 DingTalk-only Snapshot 均不会
  恢复钉钉管理界面。
- [x] 保留钉钉 Main/Core、SQLite 数据、凭据、Stream、Card 与 Outbox，不做 destructive migration。
- [ ] packaged Applications 视觉验收：Porcelain Day / Steel Night、最小窗口、200% zoom 与键盘顺序。
- [ ] PR 合入最新 `main` 并从合并后的 `main` 构建、安装 `/Applications/Rovai.app`。

## 重新开放待办（当前暂停）

- [ ] 同消息多 Bot callback 聚合为一个根请求和多个目标 `AgentRun`，完成顺序、去重、重启与超时回归。
- [ ] 执行中三按钮卡立即可见，平台 loading 不覆盖执行期；排队卡、终态卡、下一轮真实撤回完成桌面/手机真实验收。
- [ ] 内部群项目选择、Quick Chat、刷新、过期、双击和 Non-owner 形成完整 callback 闭环。
- [ ] 决定并实现或明确限制钉钉真实附件收发。
- [ ] 评估永久正文的原生 A2A `@`、回复摘要和长正文拆分。
- [ ] 加入 callback 聚合与 Card create/update/recall 的安全诊断投影。
- [ ] 通过私聊、单 Bot 群、多 Bot 群、连续排队、停止、最近输出、执行台与撤回的 packaged 双端验收后，才移除
  “敬请期待” gate。

## 验证 owner

- `apps/desktop/src/renderer/src/ChannelSettings.test.ts`：开放 Provider 过滤、固定钉钉预告、disabled/ARIA、legacy
  Snapshot 不泄露和飞书回退。
- `pnpm typecheck`、Renderer/Vitest 全量、`pnpm build:desktop`：类型、现有渠道交互与生产构建回归。
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=<main base> pnpm docs:check:ci`：版本切换、当前 UI 权威和文档路由。
- packaged App 人工检查：入口在日/夜主题均清晰置灰，真实图标比例不变，“敬请期待”可读且不产生点击反馈。
