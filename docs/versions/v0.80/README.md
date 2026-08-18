---
document_type: version-overview
version: v0.80
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-14
---

# Rovai-ai v0.80：接收者延续与可修复路由

> 当前状态：Core Draft migration、continuation projection、exact-revision mutations、发送物化与无
> fallback rejection 已完成；Renderer 标签、互斥、修复、默认文案、文字“复制”和 pointer focus 已完成，
> 自动化门禁与 localhost 桌面/窄屏交互验收通过。
>
> 前置版本：[v0.79 Camp 会话轻量打开与分段性能诊断](../v0.79/README.md)
>
> 后续版本：[v0.81 Camp 轻量打开与渐进历史](../v0.81/README.md)

## 版本目标

当用户刚刚成功把消息显式交给唯一一位非 Lead 队员时，让下一份 Draft 以轻量标签延续同一责任人，减少
遗漏 `@` 后误交 Lead。延续只表达路由，不伪造回复链；发送时由 Core 物化可审计 Structured Mention。

危险边界保持与 reply 一致：对象在编辑期间 `away`、退出 Camp 或被移除时，已有正文与附件必须保留，
发送必须阻断并要求显式换人，绝不悄悄回退 Default Lead。

## 交付范围

### Core-owned continuation

- 最近 accepted user message 只有唯一非 Lead explicit recipient 时投影候选；Agent 发言、Default、Lead、
  Broadcast 和多人消息不产生候选；
- Draft 持久 source、同来源 suppression 与 recipient touched，和 content、附件、reply 共用 revision、expiry、
  导航/重启恢复及 accepted 后消费；
- `save` 验证 Renderer 交回的 source；新增 dismiss/resolve exact-revision mutations；旧有内容 Draft 迁移时
  不从历史突然改变路由；
- send 只在无 reply、无显式 Mention、未手动改址时物化 canonical Member Mention；对象失效返回
  `continuation_recipient_required`，不创建任何发送副作用或 fallback。

### Composer routing hierarchy

- 优先级固定为 repair > reply > explicit Mention > continuation > Default Lead；
- 标签为无框单行“继续发给 @成员”，`×` 持久取消同一 source；reply 期间隐藏，按是否留下 Mention 决定
  取消 reply 后是否恢复；
- 用户主动改过接收者后，即使删光 Mention也不恢复同一 Draft 的标签；
- 空白 Draft 对象失效时取消候选；已有正文/附件时展开显式替代成员选择并阻止发送。

### 文案与交互收敛

- 仅纯 Default 状态显示“默认由 Lead · {name}接收”；显式 Mention、reply、continuation 和 repair 不再重复
  显示“实际接收者”；
- 消息操作的复制入口从 icon-only 改为可见文字“复制”，继续保留复制成功状态；
- Composer 的鼠标点击与程序化 reply focus 不再生成编辑器内层黑框；键盘 `focus-visible` 保留；
- reply dock 继续严格单行，长作者和摘要使用省略号。

## 非目标

- 不创建嵌套 thread、私密会话或 continuation reply relation；
- 不从 Agent 最后发言、普通 `@文字`、历史 reply author 或 Runtime 活动推断接收者；
- 不在对象失效后提供“仍然发送”、自动选 Lead 或自动选择另一成员；
- 不改变 Agent-authored send、Message Delivery、caller return、Task responsibility 或 Runtime admission。

## 当前验收证据

- `cargo test -p rovai-core --lib` 通过 452/452；`cargo test -p rovai-core --bin rovai-core` 通过
  73 项，3 项真实 Runtime smoke 按合同保持手工 ignored；continuation、失效空 Draft 与 migration 85
  定向回归通过；
- `cargo clippy -p rovai-core --all-targets -- -D warnings`、`cargo fmt --all -- --check`、Core check、
  `pnpm typecheck` 与 Desktop production build 通过；
- `pnpm test` 通过：ADR tests 21、Vitest 51 files / 338 tests、Node 179 tests；数据合同 fingerprint
  已推进到 v0.80 / projection schema 40；
- Python localhost 交互稿在 1440px desktop 与 390px minimum width 验收通过：延续标签无框、reply 单行
  省略、pointer reply focus 无 outline/box-shadow、失效 Draft 保留正文/附件并阻止发送，浏览器控制台无错误；
- Impeccable detector 已执行；报告的是共享样式表既有 side-tab / layout-transition 全局告警，未命中新加的
  continuation、pointer-focus、文字复制或修复空状态规则。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.79 已冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.80。 |
| ADR | 已更新 | [ADR-0187](decisions.md#adr-0187)冻结 durable source、优先级、发送物化与无 fallback。 |
| Contracts | 已更新 | [Camp Composer Draft v2](../../contracts/camp-composer-draft-v2.md)拥有新增字段、mutation、错误与迁移。 |
| Architecture | 已更新 | [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)加入 continuation component authority 与 flow。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)与[结构化 Mention](../../ui/components/structured-mentions.md)冻结标签、互斥、修复、复制和 focus 合同。 |
| Runtime Activity | 确认无需更新 | 本版本不改变 Runtime activity 映射、证据或展示。 |
| Runtime compatibility | 确认无需更新 | 本版本不改变 Runtime 版本、传输能力或兼容性矩阵。 |
| Documentation routing | 已更新 | [文档导航](../../README.md)、Contract/Architecture/ADR current 索引指向 v2 与 ADR-0187。 |
| Root README | 确认无需更新 | 项目定位与常青能力不变，Root README 不记录版本局部 Composer 交互。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0187](decisions.md#adr-0187)
- [Camp Composer Draft v2](../../contracts/camp-composer-draft-v2.md)
- [延续路由交互稿](../../prototypes/composer-continuation-routing/index.html)
