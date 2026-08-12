---
document_type: version-overview
version: v0.61
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-12
---

# Rovai-ai v0.61：队员页来源感知会话返回

> 当前状态：交互、Renderer 实现、全量前端门禁、打包 App 验收与视觉复核均已完成。
>
> 前置版本：[v0.60 有界 Tool 输出预览与按需全文复制](../v0.60/README.md)
>
> 后续版本：[v0.62 显式 A2A 调用者返回](../v0.62/README.md)

## 版本目标

让用户从具体 Camp 进入队员页后，可以从名册顶部直接识别并返回同一 Camp，不再依赖项目树或
`⌘K` 重新查找。directory Project 和“快速对话”分组内的 Camp 使用同一精确返回语义；从记忆、
Quick Chat 首页或启动恢复直接进入队员页时统一返回 App。

## 交付范围

- Main Window Session 内记录两态 `MemberReturnTarget`：只有从当前可见 Camp 进入时保存稳定
  Camp ID、Camp 标题与导航上下文，其他来源只保存 `app`；
- 返回具体 Camp 时复用现有 `activateCamp` 路径读取最新权威 Snapshot、恢复被隐藏的 directory
  Project 并更新最近访问；目标被删除或不可读时安全回到 Quick Chat 首页；
- 返回 App 时清除失效的活动 Camp 投影，不恢复 Memory 的筛选、选中项或滚动位置；
- 队员名册顶部把旧 icon-only“返回首页”替换为开放式来源书签：具体 Camp 显示
  “返回会话 · {项目或快速对话} / {Camp 标题}”，其他来源显示“返回 App”；
- 提供 `⌘[` 等价快捷键；Dialog、Menu 或其他临时浮层打开时不穿透，点击和快捷键都继续经过
  既有未保存 Runtime 草稿离开保护；
- 不改变队员身份、半身照、Runtime 配置、排序、Presence、Memory、Camp、导航或启动恢复的
  领域与持久化合同。

## 冻结边界

- `MemberReturnTarget` 只在当前 Renderer 窗口存活，不写 Core、SQLite、localStorage、
  Restorable Location 或 Main-owned 偏好；
- “快速对话”分组里的具体 Camp 仍是可精确返回的 Camp，不能因其不是 directory Project 而
  降级为“返回 App”；
- 从 Memory、Quick Chat 首页、Settings 间接恢复或启动直达队员页时不建立伪造的深层历史栈；
- 返回目标失效时不保留死按钮、不创建 Toast 式伪成功，也不绕过权威 Camp 读取；
- 不复制会话列表到队员名册，不恢复空白拖拽栏，不改变队员页右侧 Header、半身照或 Runtime
  状态入口。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.60 以完整验收事实冻结为 historical，v0.61 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 确认无需更新 | 仅增加 Renderer 当前窗口内的瞬时导航上下文，不形成跨版本领域、持久化或进程决策 |
| Contracts | 确认无需更新 | 不改变 Core、IPC、Envelope、receipt、Read Side 或写命令字段 |
| Architecture | 确认无需更新 | App、Camp 激活路径和成员工作台职责不变，仅组合既有 Renderer 导航能力 |
| UI | 已更新 | UI 索引与 Neutral Porcelain + Steel 详规冻结两态返回、快捷键、失效回退和视觉层级 |
| Runtime Activity | 确认无需更新 | 不改变 AgentRun、Canonical Activity、Evidence 或执行过程展示 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 发现、配置、调用或兼容性结论 |
| Documentation routing | 已更新 | 版本索引改由 v0.61 作为唯一 current；`docs/README.md` 继续通过该动态指针和 UI 索引路由，无需增加新任务入口 |
| Root README | 确认无需更新 | 项目定位与常青能力集合不变，根 README 不记录局部 Renderer 导航改进 |

## References

- [v0.61 实施与验收计划](implementation-plan.md)
- [Renderer UI 规范](../../ui/README.md)
- [App Shell 与统一侧栏](../../ui/components/app-shell-navigation.md)
- [桌面 UI 验收与隔离数据](../../development/ui-acceptance.md)
