---
document_type: implementation-plan
version: v0.78
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-14
---

# v0.78 实施与验收计划

## Checkpoint 0：版本、决策与交互

- [x] 从已完成 v0.77 的 `origin/main` 基线开启唯一 current v0.78；
- [x] 接受 ADR-0186 与 Camp Composer Draft v2，冻结 source、suppression、touched 与无 fallback；
- [x] 产出轻量无框 HTML 交互稿并按用户反馈收敛 continuation、默认文案、单行 reply 与复制文字。

## Checkpoint 1：Core Draft 与 migration

- [x] migration 84 / schema 39 持久化 continuation source、suppression 与 recipient touched；
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

- [ ] Core migration、candidate、dismiss/touched、send materialization、unavailable/replacement 定向测试；
- [ ] Renderer helper、markup、theme、typecheck 与完整 Vitest；
- [ ] Rust workspace tests/check、strict Clippy、desktop build 和文档治理；
- [ ] localhost 真实交互验收 desktop + minimum width，并记录 Impeccable detector；
- [ ] 回填完成证据、把本计划与版本状态改为 complete。
