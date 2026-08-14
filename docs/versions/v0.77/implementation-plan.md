---
document_type: implementation-plan
version: v0.77
authority: implementation-plan-and-acceptance
status: in_progress
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

- [ ] 增加 next schema migration 和 projection version，在 `camp_composer_draft` 保存 reply target 与
  recipient-selection requirement，现有 Draft 无损迁移为 null reply；
- [ ] `CampComposerDraftView` 投影 reply author、current addressability、有界 excerpt 和 requirement；
- [ ] 实现 `startReply / cancelReply / resolveReplyRecipient` exact-revision mutations，并让 content/attachment
  mutations 保留 reply 字段；
- [ ] 覆盖 active Agent、user/system、away、leave requested、removed、missing target、broadcast、已有 Mention、
  revision conflict、discard 与 expiry tests。

## Checkpoint 2：Draft-only send 与原子拒绝

- [ ] 从 user send IPC/DomainCommand 删除 `replyToCampMessageId`，只从 exact Draft revision 读取 reply；
- [ ] accepted transaction 写入 `CampMessage.reply_to_camp_message_id` 并消费完整 Draft；
- [ ] 新增 `reply_recipient_required`，保留既有 `mention_target_unavailable` 和
  `camp_message.invalid_reply`，三者均证明零消息/Turn/Run/Delivery 与零 fallback；
- [ ] 覆盖 Snapshot 后作者变 away/left/removed、替代成员再次失效和 replay/idempotency tests。

## Checkpoint 3：Renderer timeline 与 Composer

- [ ] 在稳定 user/agent 消息增加回复入口；optimistic message 不提供入口；
- [ ] 实现无框单行省略的 reply dock、取消、完整 recipient fanout、失效作者 chooser、inline error 与焦点恢复；
- [ ] 让 Draft mutation 使用既有 per-Camp 串行队列，导航/重载/重启恢复同一 reply state；
- [ ] optimistic/accepted user message 携带冻结父引用，accepted 后清空，rejected 后完整保留；
- [ ] 时间线渲染一层单行省略父引用，并以 same-Camp anchor load 精确定位或显示 source unavailable。

## Checkpoint 4：视觉、可访问性与发布证据

- [ ] 以已确认方案 C 映射 Porcelain Day / Steel Night semantic tokens，不增加 reply dock 独立边框、底色、
  阴影、角色气泡底色或主题分叉；
- [ ] 验证鼠标点击 reply 后编辑器获得插入光标且 Composer 边框/阴影不变；键盘 reply 与自然 tab order
  保留局部 `focus-visible`，并覆盖 `aria-live` error、长名/长摘要、200% zoom 和 reduced motion；
- [ ] 完成 1440×920、1040×700、736px、360px 双主题截图与真实 App 交互验收；
- [ ] 运行 Core/Renderer 定向与完整 tests、typecheck、build、文档治理和 diff 检查；
- [ ] 回填证据、冻结未完成项并发布后，才把 v0.77 标记为 complete。

## 当前证据与缺口

- 已完成：版本隔离、v0.76 基线确认、三方向 HTML 交互稿与方案 C 选择、ADR-0185、Camp Composer Draft v1、
  Architecture/UI/Documentation 路由；
- 已验证：交互稿静态双主题与窄屏布局；文档治理和最终 Git 检查待本批次结束时运行；
- 未实现：Core migration/store/mutations、send command 收窄、Renderer 生产组件、自动化与真实 App 验收；
- 当前禁止把设计文档或原型状态解释为生产能力已完成。
