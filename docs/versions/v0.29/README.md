---
document_type: version-overview
version: v0.29
lifecycle: current
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-01
---

# Rovai-ai v0.29 队员工作台信息架构

> 状态：生产设计与验收矩阵已冻结；Renderer 实施与隔离桌面验收已完成
>
> 前置版本：[v0.28 In-App Notifications](../v0.28/README.md)
>
> 生产设计：[production-design.md](production-design.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

## 版本意图

重新组织队员页的名册、身份与运行配置入口，使大量队员仍可高效浏览，同时保留
Agent Runtime 原生字段、六字段身份、独立保存边界与 Arctic Dawn 的可访问性合同。

## 已确认范围

- 进入“队员”一级页后，统一侧栏中部切换为队员名册，不再同时显示“置顶 / 项目”。
- 页面主内容不再保留第二份独立名册；右侧空间用于当前队员详情。
- 品牌、全局一级入口、“跳转到对话…”和底部设置保持固定。
- 离开队员页后，侧栏中部恢复对应页面的普通导航投影。
- 当前队员详情使用互斥的“身份 / 运行配置”两个顶层 Tab，不再把两个工作区纵向堆叠。
- 未保存的运行配置草稿只属于当前队员；同一队员切换 Tab 时保留，切换队员或离开
  队员页前必须显式继续编辑或放弃更改。
- Member Order 继续可编辑；侧栏名册通过专门排序模式提供拖拽和等价键盘移动，不把
  排序把手与运行状态快捷入口长期挤在同一行。
- 普通产品界面统一使用“Agent 运行时”，队员详情区域使用“运行配置”；不再使用
  “执行引擎”作为同一概念的别名。
- 名册 Runtime 快捷入口使用四类紧凑投影：可用、未配置、需要处理和中性检查/未知；
  不把生产状态强行压缩成 A3 的三个符号。
- 本版本是 Renderer 信息架构改造，不新增 Migration，也不改变 SQLite、Core、IPC/
  Contracts 或 Runtime Adapter 合同。
- 名册以 100 位未移除队员为 v0.29 验收上限；超过 20 位时提供本地名称/团队角色筛选，
  不引入分页、虚拟列表或 Core 搜索。

## 当前边界

- A3 HTML 是必须实际打开并交互核对的设计输入，不是生产字段、组件或静态数据真源。
- 未被本版本明确替代的 Renderer 规则继续遵守
  [Arctic Dawn V3](../../ui/arctic-dawn.md)。
- Runtime、模型与原生权限继续遵守 [ADR-0082](../../adr/0082-member-owned-runtime-parameters.md)。
- 六字段身份与独立保存边界继续遵守 [ADR-0085](../../adr/0085-run-frozen-six-field-member-identity-context.md)。
- Camp 共享摘要模型入口继续遵守 [ADR-0060](../../adr/0060-opaque-member-routing-identity.md)，
  不因 A3 未展示而删除。
- v0.29 实施保持 Renderer-only；没有修改 Migration、SQLite、Core、IPC/Contracts 或
  Runtime Adapter 语义。

## 设计状态

侧栏与页面内名册的所有权、详情双 Tab、单队员运行配置草稿边界、Member Order 模式、
Runtime 状态投影、Renderer-only 范围与 100 位规模边界已经确认。关键异常路径、既有能力
继承和完整验收矩阵已经收敛并冻结在[生产设计](production-design.md)。用户于
2026-08-01 明确确认文档已经形成共同理解并授权实施。Renderer 生产改造、组件测试、
桌面构建和隔离 UI 验收已经完成；具体验证证据见[实施计划](implementation-plan.md)。
