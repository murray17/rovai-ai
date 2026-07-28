---
document_type: version-overview
version: v0.15
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-27
---

# Rovai-ai v0.15 成员生命周期与 Camp 执行准入

> 状态：协议决策已冻结；编码检查点 3/3，实施与桌面打包验收完成
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.14 营地伙伴身份视觉与受管本地头像](../v0.14/README.md)
>
> 跨版本决策：
> [ADR-0057](../../adr/0057-member-presence-and-retained-removal.md) ·
> [ADR-0058](../../adr/0058-collaboration-v4-presence-aware-admission.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.15 将成员管理从 legacy `active | disabled | archived` 收敛为用户可理解的
“在队／暂时离队／永久移除”，并让 Camp 在不耦合成员页的前提下可靠处理 Default
Lead、消息执行和不可用成员。

本版本同时重构成员页的信息层级：

- 成员在队状态与执行引擎配置/健康状态分开表达；
- 暂时离队是低副作用、可恢复操作；
- 永久移除不擦除数据，而是让身份退出所有活动系统；
- Default Lead 在进入 Camp 时惰性修复；
- 输入框不根据异步执行条件提前锁死，最终准入由 Core 在提交时权威判断；
- 执行引擎 UI 中文化，但完整保留 Adapter-specific 模型和权限能力。

本轮提供的 `rovai-member-management-design` 设计包是版本输入，不是规范真源。
原包中的永久数据删除、头像清理、通用权限三档、格言、统计卡、方形辉光头像及
禁用 Composer 等内容均已被当前 ADR、Meridian 和本文重新裁决。

## 已确认范围

### 1. Member Presence

`AgentProfile` 的成员在队状态改为：

```ts
type MemberPresence = "present" | "away" | "removed";
```

- 新成员默认 `present`，即使没有配置执行引擎。
- `present ⇄ away` 可逆；`present/away → removed` 不可逆。
- 配置、清除或探测 Runtime 均不改变 Presence。
- Runtime CLI、认证或健康状态变化也不改变 Presence。
- `removed` Profile 从成员管理和所有活动入口消失。

### 2. 暂时离队

暂时离队只修改 AgentProfile Presence：

- 不扫描或修改 Camp、CampMember、Default Lead 或 Task；
- 不清除身份、头像、成员指令、Runtime、MCP Assignment 或 Memory；
- 不打断已经启动的 AgentRun；
- 阻止为该成员创建新的 AgentRun；
- 未完成 Task 保留原 Assignee，进入 Camp 后显示负责人不可用；
- 归队不自动抢回已经有效的 Default Lead。

成员页直接执行暂时离队并用 Toast 反馈，不弹出 Camp 交接确认。重新归队同样是直接
操作。

### 3. 永久移除

“永久删除成员”改名为“永久移除成员”。它只将 Presence 写为 `removed` 并记录
`removedAt`，不清空或物理删除任何现有数据。

保留：

- handle、姓名、角色、persona 和成员指令；
- `avatarRef` 与受管头像文件；
- Runtime installation ID、模型与权限配置；
- MCP Assignment 原始数据；
- Companion、Relationship 与其他 Memory 数据；
- Camp membership、Conversation、消息、Task、AgentRun、ContextManifest 和审计。

活动系统必须忽略这些保留数据：removed Profile 不参与执行、健康检查、MCP/Skill
投影、Runtime 活动引用计数、Memory 上下文、Lead、提及或新 Task 指派。

永久移除的唯一阻塞项是非终态 AgentRun。Default Lead 和未完成 Task 不阻塞；前者
进入 Camp 时修复，后者保留原负责人并等待用户显式改派。

确认 Dialog 要求输入唯一 handle。移除后 handle 永久不复用。成员管理页不展示
removed 分组；历史 Camp 仍显示原头像、姓名和角色，但身份位不可点击。

### 4. Camp membership 与 Default Lead

CampMember 继续只表示 Profile 与 Camp 的关系和 Camp-specific 权限，不复制全局
Presence。离队、归队和永久移除都不修改 CampMember。

进入 Camp 时，Renderer 先执行幂等的 `camp.default_lead.reconcile`，再读取纯
`camps.snapshot`：

1. 当前 Lead 仍是该 Camp 的在队成员：保持不变；
2. 当前 Lead 无效：按最新全局 Member Order 选择第一位在队成员；
3. 没有在队成员：将 Default Lead 持久化为 `null`。

Runtime 配置和 Readiness 不参与既有 Camp 的 Lead 有效性或继承。成员重排不立即
更换仍然有效的 Lead，但会影响未来的继承优先级。

### 5. 首页初始 Lead

首页尚未存在 Camp，规则与既有 Camp 的继承不同：

- 新 Camp 初始 membership 包含所有 `present` Profile；
- 初始 Lead 是当前 Member Order 中第一位“在队且 Runtime 配置完整”的 Profile；
- Runtime 当前健康度不会使 Core 跳到后一位；
- 没有已配置 Runtime 的在队成员，或选中 Lead 当前不能执行时，提交失败且不创建
  Camp。

### 6. 提交与执行准入

没有 Lead、没有 Runtime 或 Runtime 当前不可用时，Composer 文本框仍可输入；发送
按钮只因空文本或正在提交而禁用。提交失败：

- 不创建 CampMessage、ConversationMessage、CampTurn 或 AgentRun；
- 首页不创建空 Camp；
- 不自动改投其他成员；
- 保留原草稿并显示针对阻塞成员/原因的 Toast。

既有 Camp 没有可继承成员、Default Lead 为 `null` 时，提交 Toast 为
「当前无可用成员」；首页没有任何已配置执行引擎的在队成员时，Toast 为
「当前没有已配置执行引擎的成员」。

默认消息只投递持久 Default Lead。Lead 没有 Runtime 时，即使其他成员可执行，也
不能静默改投。

多目标请求必须全部通过准入才原子提交。`@所有成员` 指所有在队 Camp 成员；任一
成员不可执行则整条失败。`@` 候选显示所有在队成员，不因 Runtime 隐藏身份，但要
标出“未配置”或“需要检查”。手动输入离队/removed 成员的精确 handle 必须明确
拒绝，不能当普通文本后退化为默认 Lead。

### 7. 成员管理 UI

成员页使用单一工作表面：

- 左侧名册按“在队／暂时离队”分组；removed 完全过滤；
- 每行单独显示执行引擎状态：已就绪、需要检查、未配置；
- Presence 和 Runtime 状态绝不互相替代；
- 右侧详情沿用 `MemberPortrait`，不使用方形主头像、辉光或衬线标题；
- 详情不展示格言、长期记忆数量、Camp 数量或历史统计卡；
- 身份头附近提供离队/归队操作；
- 页面末尾单独放置永久移除危险区；
- 不在成员页展示或管理 Camp membership。

运行配置字段统一使用“执行引擎”文案，但仍由 Adapter descriptor 渲染实际模型、
模型选项和权限配置。不得把不同 Adapter 压缩成虚构的通用权限等级。

## 非目标

- 不实现成员、Memory、历史记录或头像文件的隐私擦除。
- 不提供 removed 恢复、回收站、已移除成员分组或 handle 复用。
- 不因为 Runtime 清除、安装变化、认证变化或探测失败自动离队。
- 不在成员页选择每个 Camp 的 Lead successor。
- 不增加 Camp-specific Member Order、循环继承游标或加入时间优先级。
- 不自动取消 AgentRun、清空/改派 Task 或退出 Camp membership。
- 不在提交失败后保存待发送消息、部分目标消息或空 Camp。
- 不增加格言字段、成员统计聚合接口或成员活动分析页。
- 不删除/GC 最终头像资产，也不改变 ADR-0056 的文件安全边界。
- 不新增 UI 框架、字体、动画库、状态管理库或跨 Adapter 通用权限模型。

## 升级策略

v0.15 计划使用 Migration v26：

```text
legacy active   → present
legacy disabled → away
legacy archived → away
```

Migration 更新 Profile Presence 约束并增加 `removed_at`。所有身份、头像、Runtime、
Memory、Camp、Task 和历史数据原样保留。旧 `archived_at` 只作为 legacy 数据保留，
不再是当前生命周期权威。

新数据库 Seed 全部写入 `present`。Migration 不根据 Runtime 配置推断 Presence，
不扫描 Camp，也不伪造 Lead 交接。

## 验收模型

自动验证至少覆盖：

- 新库、v0.14 fixture 与 active/disabled/archived 混合 fixture 的 Migration；
- Presence 状态机、removed 终态、handle 保留和 version/idempotency；
- away 不改 Camp/Task/Run/Memory/Runtime，现有 Run 继续；
- removed 非终态 Run 阻塞及所有活动读侧过滤；
- Runtime/Memory/MCP/头像保留但不参与 removed 活动系统；
- Camp Lead 幂等修复、最新 Member Order、无成员 Lead=null；
- 首页初始 Lead 与既有 Camp 继承的不同 Runtime 规则；
- 默认/显式/广播地址、离队 handle、全目标原子准入和零副作用失败；
- Member 页面 Day/Night、键盘、焦点、主题切换草稿与双尺寸布局。

打包 App 验收继续覆盖：

```text
fresh database + v0.14 upgrade fixture
× Day + Night
× 1440×920 + 1040×700
× mouse + keyboard
× leave/rejoin/remove/restart/Camp reconciliation
```

## 当前版本状态

ADR-0057/0058、Migration v26、Presence/Removal 命令、Camp Lead reconcile、原子
执行准入、Contracts 和 Renderer 主路径已经实现，并通过 Core、TypeScript、
Renderer、Smoke 与打包 App 回归。`pnpm accept:member-lifecycle-ui` 已在隔离数据中
覆盖 fresh/v0.14 upgrade、冷重启、Presence/Runtime 独立、保留式移除、Camp Lead
惰性修复、无可用成员 Composer、Day/Night、双尺寸及鼠标/键盘路径；最终 arm64 App
也通过严格 codesign 校验。逐项证据见
[实施与验收清单](implementation-plan.md)。
