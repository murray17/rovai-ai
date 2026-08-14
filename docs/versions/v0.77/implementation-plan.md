---
document_type: implementation-plan
version: v0.77
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-14
---

# v0.77 实施与验收计划

## Checkpoint 0：版本、交互与长期边界

- [x] 在 v0.76 完成并推送后，从同一 `origin/main` 基线开启唯一 current v0.77；
- [x] 接受 ADR-0185，冻结 durable reply intent、Draft-only user send 与无 Default Lead fallback；
- [x] 新增 Camp Composer Draft v1、Architecture/UI 路由和九项跨版本文档影响判断；
- [x] 产出平衡型、接收者优先、轻量引用三个可切换 HTML 方向及五类危险边界场景；
- [x] 用户确认方案 C（轻量无框）作为生产方向；Composer reply dock 与时间线父引用不绘制独立容器，
  作者与摘要仍只占一个可视行并在超出时省略，Core 状态机不依赖该视觉选择。

## Checkpoint 1：Core Draft schema 与 mutation

- [x] 增加 next schema migration 和 projection version，在 `camp_composer_draft` 保存 reply target 与
  recipient-selection requirement，现有 Draft 无损迁移为 null reply；
- [x] `CampComposerDraftView` 投影 reply author、current addressability、有界 excerpt 和 requirement；
- [x] 实现 `startReply / cancelReply / resolveReplyRecipient` exact-revision mutations，并让 content/attachment
  mutations 保留 reply 字段；
- [x] 覆盖 active Agent、user/system、away、leave requested、removed、missing target、broadcast、已有 Mention、
  revision conflict、discard 与 expiry tests。

## Checkpoint 2：Draft-only send 与原子拒绝

- [x] 从 user send IPC/DomainCommand 删除 `replyToCampMessageId`，只从 exact Draft revision 读取 reply；
- [x] accepted transaction 写入 `CampMessage.reply_to_camp_message_id` 并消费完整 Draft；
- [x] 新增 `reply_recipient_required`，保留既有 `mention_target_unavailable` 和
  `camp_message.invalid_reply`，三者均证明零消息/Turn/Run/Delivery 与零 fallback；
- [x] 覆盖 Snapshot 后作者变 away/left/removed、替代成员再次失效和 replay/idempotency tests。

## Checkpoint 3：Renderer timeline 与 Composer

- [x] 在稳定 user/agent 消息增加回复入口；optimistic message 不提供入口；
- [x] 实现无框单行省略的 reply dock、取消、完整 recipient fanout、失效作者 chooser、inline error 与焦点恢复；
- [x] 让 Draft mutation 使用既有 per-Camp 串行队列，导航/重载/重启恢复同一 reply state；
- [x] optimistic/accepted user message 携带冻结父引用，accepted 后清空，rejected 后完整保留；
- [x] 时间线渲染一层单行省略父引用，并以 same-Camp anchor load 精确定位或显示 source unavailable。

## Checkpoint 4：视觉、可访问性与发布证据

- [x] 以已确认方案 C 映射 Porcelain Day / Steel Night semantic tokens，不增加 reply dock 独立边框、底色、
  阴影、角色气泡底色或主题分叉；
- [x] 验证鼠标点击 reply 后编辑器获得插入光标且 Composer 边框/阴影不变；键盘 reply 与自然 tab order
  保留局部 `focus-visible`，并覆盖 `aria-live` error、长名/长摘要、200% zoom 和 reduced motion；
- [x] 完成 1440×920、1040×700、736px、360px 双主题截图与真实 App 交互验收；
- [x] 运行 Core/Renderer 定向与完整 tests、typecheck、build、文档治理和 diff 检查；
- [x] 回填证据、冻结未完成项并发布后，才把 v0.77 标记为 complete。

## 完成证据

- Core：migration 83 / schema 38、Draft mutations、exact Draft-only send、unavailable/race/fallback 负向用例；
- Renderer：Reply action/dock/chooser/parent anchor、pointer focus suppression、单行 ellipsis、Day/Night 和键盘/ARIA 用例；
- 真实 App：隔离 userData 中完成 available、away、explicit replacement、accepted parent quote、
  reduced-motion 与收起检查器后的 200% zoom 流程；
- 发布门禁：完整 Rust/TypeScript tests、strict Clippy、typecheck、macOS arm64 build/codesign、
  文档治理、diff 检查与附件 smoke 全部通过后关闭本计划。
