---
document_type: adr
id: ADR-0186
title: Durable Composer Recipient Continuation
status: accepted
date: 2026-08-14
decision_scope: cross-version
source_version: v0.78
supersedes: []
superseded_by: null
---

# ADR-0186: Durable Composer Recipient Continuation

## Context

用户连续把多条消息交给同一位非 Lead 队员时，每次重新输入 `@` 容易遗漏；遗漏后既有 Default Lead
规则会把下一条消息交给 Lead。单纯在 Renderer 记住“上一次 @ 的人”无法证明来源消息已经被 Core
接受，也无法在导航、重载、附件先于正文、回复临时覆盖或发送失败后保持一致。

延续对象还可能在用户编辑期间变为 `away`、退出 Camp 或被移除。若界面隐藏标签后让发送事务走
Default Lead，用户看到的“继续发给原队员”和实际接收者会分叉。延续必须进入 Core-owned Draft 的
可验证状态，同时继续与 reply relation、历史 Agent 发言和普通 Default Lead 路由保持正交。

## Decision

1. 延续候选只来自当前 Camp 最近一条已接受的 user-authored CampMessage 的最终冻结寻址。只有该消息
   为 `explicit`、恰好一个 Agent ID 且该 Agent 不是当前 Default Lead 时，空白 Draft 才可投影候选。
   Agent 后续发言不推进候选；Default、Broadcast、多 Agent 或 Lead 消息清除下一 Draft 的候选资格。
2. Core Composer Draft 持久化 nullable continuation source、同来源抑制标记与
   `recipientSelectionTouched`。Renderer 把曾向用户展示的 source 随 exact-revision save 交回 Core；
   Core 只接受仍对应最近合格 user message 的 source。点击 `×`、用户主动改变接收者或失效空白候选
   会持久抑制该来源，导航、重载或重新进入 Camp 不得让同一来源复现。
3. continuation intent 不是 reply relation，也不是历史 recipient inference。发送时，若 Draft 没有
   reply、显式 Member/All Mention、接收者修复或手动寻址痕迹，Core 才把可用延续对象物化为 canonical
   Structured Member Mention，再按既有 Structured Content 规则冻结 Explicit addressing；生成的
   CampMessage 不写 `replyToCampMessageId`。
4. Draft 路由优先级固定为：未解决接收者修复、reply intent、显式 Structured Mention、recipient
   continuation、Default Lead。用户一旦主动改变接收者，即使随后删除全部 Mention，同一 Draft 也不再
   恢复延续，而是明确回到 Default Lead。回复 Agent 自动加入的 Mention 在取消回复后保留，因此同样
   压过延续；回复用户消息未产生 Mention 且未手动改址时，取消回复可以恢复此前隐藏的延续。
5. 动态候选在 Draft 仍为空且无附件时失效，可以持久抑制并回到 Default Lead。候选已经进入有正文或
   附件的 Draft 后失效，Core 投影 `recipientSelectionRequired` 并以
   `continuation_recipient_required` 拒绝发送。只有显式选择另一个当前可接收成员、写入 Structured
   Mention 后才可继续；不得删除 Draft、创建发送副作用或静默改投 Lead。
6. accepted send 消费整个 Draft。下一份 Draft 重新只从刚接受消息的最终冻结寻址计算，因此恰好一个
   非 Lead 显式接收者会继续建立候选，Lead、多人、所有队员和默认路由都不会建立候选。

本 ADR 扩展 ADR-0080 的 Draft 持久范围与 ADR-0128 的 exact Draft-only user send，并复用 ADR-0185
关于 reply/recipient 正交、显式修复和无 Default Lead fallback 的安全边界；不改变 Agent-authored send、
Message Delivery 或 Agent caller return。

## Consequences

- Draft schema、Read Model、IPC 与 send admission 需要同一版本迁移，旧的有内容 Draft 必须标记为已触碰
  接收者，避免升级后凭历史突然改变路由；
- Renderer 的标签只是 Core projection，不能把本地历史、最后一条 Agent 发言或显示名文本当作路由真源；
- 发送后的 Structured Content 会包含物化 Mention，历史消息、复制、上下文与审计看到的接收者一致；
- 失效对象会增加一次显式换人摩擦，但草稿、附件和用户可见意图不会丢失或被错误交付；
- Presence 仍可能在 Renderer 预检后变化，Core rejection 是最终权威。

## Rejected Alternatives

- **只把上次接收者保存在 Renderer/localStorage：** 不能证明来源已接受，也无法与 Draft revision、附件、
  导航和多窗口竞态保持一致。
- **从最后一条 Agent 发言推导接收者：** 把对话顺序误当用户寻址，Agent 回答会无意改变下一条责任人。
- **直接复用 reply relation：** 延续不回应某条父消息；伪造引用会混淆公共上下文边与执行路由边。
- **对象失效后隐藏标签并走 Default Lead：** 实际责任人与用户先前看到的意图不一致，违反无 fallback
  安全边界。
- **删除 Mention 后自动恢复标签：** 路由控件会反复跳变，也会覆盖用户明确撤销接收者的手势。

## References

- [v0.78 版本目标](../versions/v0.78/README.md)
- [Camp Composer Draft v2](../contracts/camp-composer-draft-v2.md)
- [ADR-0080: Durable Camp Composer Draft](0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md)
- [ADR-0128: Structured Draft-Only User Message Submission](0128-structured-draft-only-user-message-submission.md)
- [ADR-0185: Durable Composer Reply Intent](0185-durable-composer-reply-intent-and-explicit-recipient-resolution.md)
- [ADR-0058: Presence-Aware Routing and Execution Admission](0058-collaboration-v4-presence-aware-admission.md)
