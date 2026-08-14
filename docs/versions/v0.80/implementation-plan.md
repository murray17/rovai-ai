---
document_type: implementation-plan
version: v0.80
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-14
---

# v0.80 实施与验收计划

## Checkpoint 0：版本、决策与交互

- [x] 从已开启 v0.79 的最新 `origin/main` 基线顺延并开启唯一 current v0.80；
- [x] 接受 ADR-0187 与 Camp Composer Draft v2，冻结 source、suppression、touched 与无 fallback；
- [x] 产出轻量无框 HTML 交互稿并按用户反馈收敛 continuation、默认文案、单行 reply 与复制文字。

## Checkpoint 1：Core Draft 与 migration

- [x] migration 85 / schema 40 持久化 continuation source、suppression 与 recipient touched；
- [x] Core 只从最近 accepted user message 投影唯一非 Lead explicit candidate；
- [x] `save / dismissContinuation / resolveContinuationRecipient` 使用同一 exact revision；
- [x] 旧有内容/附件 Draft 迁移为 touched，避免升级后历史路由突变。

## Checkpoint 2：发送物化与竞态拒绝

- [x] exact Draft send 在满足优先级时物化 canonical Member Mention，且不创建 reply relation；
- [x] 对象失效返回 `continuation_recipient_required`，保留 Draft 并证明零 Default Lead fallback；
- [x] explicit replacement 写入当前有效 Member Mention；accepted 后按最终冻结接收者推进下一 Draft。

## Checkpoint 3：Renderer 状态与视觉

- [x] 实现无框 continuation 标签、持久 `×`、reply/explicit 优先级、默认 Lead 独占文案；
- [x] 实现空白失效 suppression、有 payload 失效 repair 与显式换人；
- [x] 消息复制改为可见文字，reply 保持单行省略，pointer focus 不增加编辑器内框；
- [x] 键盘 focus、ARIA error/status、Day/Night 与窄宽状态复用既有 semantic tokens。

## Checkpoint 4：验证与发布

- [x] Core migration、candidate、dismiss/touched、send materialization、unavailable/replacement 定向测试；
- [x] Renderer helper、markup、theme、typecheck 与完整 Vitest；
- [x] Rust library/Main tests、check、strict Clippy、Desktop build 和文档治理；
- [x] localhost 真实交互验收 desktop + minimum width，并记录 Impeccable detector；
- [x] 回填完成证据、把本计划与版本状态改为 complete。

## 完成证据

- Core library 452/452，Core Main 73 passed / 3 manual Runtime smoke ignored；continuation、空白失效、
  migration 84→85 串联和无 fallback 定向测试通过；
- 完整 `pnpm test`、TypeScript、strict Clippy、Rust format、Desktop production build、文档治理与 diff
  门禁通过；
- localhost 交互稿完成 1440px / 390px 两档视觉与交互验收，浏览器控制台无错误；
- Impeccable detector 的输出仅包含共享样式表既有全局告警，没有命中新加的 continuation surface 规则。
