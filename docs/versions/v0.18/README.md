---
document_type: version-overview
version: v0.18
lifecycle: current
authority: version-scope-and-status
last_updated: 2026-07-28
---

# Rovai-ai v0.18 伙伴记忆自动形成与长期记忆工作台

> 状态：Core、Migration、Contracts、Desktop Renderer、自动测试与打包 App
> 双尺寸视觉验收已完成；键盘与真实 Runtime 场景待验收
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.17 可中断执行与持久会话证据](../v0.17/README.md)
>
> 跨版本决策：
> [ADR-0064](../../adr/0064-default-on-bounded-automatic-partner-memory.md)
>
> UI 规范：[长期记忆页](../../ui/long-term-memory.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.18 把长期记忆从设置项提升为日常协作工作台，并让伙伴在严格额度与低权威边界内
自动形成可立即使用的伙伴经验与协作默契。

本版本同时完成：

1. 应用级自动形成策略默认开启，不再要求首次确认；
2. 所有合法的非家园新增都可自动形成，家园共识和全部修订仍需用户决定；
3. 自动形成内容立即生效但低于用户明确确认的记忆；
4. 长期记忆成为一级导航，普通 pending 提案与自动形成记忆分开治理；
5. 用户通过同一套确认、修订、停止沿用和遗忘操作管理所有记忆。

## 已确认范围

### Core 行为

- `automaticPartnerMemoryEnabled` 是唯一应用级开关，fresh 与 v29 升级后默认开启；
- Companion 的 Preference、Agreement、Lesson 新增均可自动形成；
- Relationship 的 Agreement、Lesson 新增可按 mutual 或当前伙伴指向对方的 directed
  方向自动形成；
- Hearth 新增和所有 `revise` 永远保持 pending；
- 每个 AgentRun 最多自动形成 1 条；
- 每位伙伴、每个无序伙伴对最多 8 条正在沿用的 provisional 自动记忆；
- 普通容量不足、策略关闭或自动额度用尽时，合法建议保留为 pending；
- Secret、重复、非法方向、stale 和 fenced 请求继续拒绝；
- 可选“标记为已确认”创建同正文 confirmed Revision 并释放自动额度。

### 权威和安全

- 自动形成内容使用 `provisional` Authority，立即进入只读 Projection；
- 当前输入、权限、仓库和协作真实状态优先；
- `user_confirmed` Memory 高于 `provisional` Memory；
- provisional 偏好与约定可以低优先级指导普通协作，但不能表示用户授权、批准或安全
  决策；
- 关闭策略只改变未来建议，不批量修改已有记忆；
- Renderer、Skill 和 Runtime 不能直接写正式 Memory Authority。

### Desktop

- 图标轨顺序为“新对话 / 成员 / 长期记忆 / 设置”，记忆不再属于设置分区；
- 页面使用概览条、策略条、普通提案抽屉、Scope Tab、治理过滤、搜索及列表/详情双栏；
- 自动形成记忆显示“自动形成”，不再显示“未确认”；
- 普通 pending Proposal 只出现在“等待确认的提案”抽屉；
- 每次自动形成产生可关闭通知和“查看”深链；
- 页面会话保留 Scope、治理过滤、搜索、选中项和列表滚动位置。

## 非目标

- 不自动形成家园共识。
- 不自动修订、替代、停止沿用、确认或遗忘现有记忆。
- 不把 provisional 内容升级为用户表态或权限。
- 不取消 Secret Filter、重复检测、Run fencing 或普通容量。
- 不增加第二个数据库、Renderer 记忆真源或隐藏批量清理。
- 不为未发布的旧开关保留兼容别名或 acknowledgement 门。

## 升级策略

v0.18 使用 Core Migration v29：

- 将旧 `memory_auto_policy` 表替换为
  `automatic_partner_memory_enabled + version + updated_at`；
- 升级后策略设为开启并增加 policy version；
- 删除未发布的 Companion-Lesson-only 字段和 acknowledgement 字段；
- Memory、Revision、Proposal 和 Projection 内容原样保留；
- 不自动确认、停止沿用或遗忘已有记忆。

## 当前版本状态

截至 2026-07-28，Migration v29、Core 自动矩阵与双重额度、Contracts、Runtime/Skill
指导、一级长期记忆页、提案抽屉、通知和自动测试已经落地。Core 全库测试、TypeScript
类型检查、Renderer 测试、production Renderer build 与隔离数据库 Memory smoke 已通过。

打包 macOS App 已完成 Meridian Day `1440×920` 与 Meridian Night `1040×700`
验收，双栏布局无横向溢出；默认开启、数据库升级、创建/修订、停止/恢复、永久遗忘、
投影恢复与重启持久化均已通过打包产物的 Renderer-to-Core IPC 验证。键盘焦点、
提案抽屉完整可访问性和真实 Runtime 自动形成场景仍待发布前验收。
