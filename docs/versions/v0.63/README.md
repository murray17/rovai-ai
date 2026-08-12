---
document_type: version-overview
version: v0.63
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-12
---

# Rovai-ai v0.63：MCP 队员分配工作台与开放 Library

> 当前状态：交互、Renderer、完整自动化门禁、隔离打包 App 验收与视觉复核均已完成。
>
> 前置版本：[v0.62 显式 A2A 调用者返回](../v0.62/README.md)
>
> 后续版本：[v0.64 Accepted Input 恢复阻断与安全收敛](../v0.64/README.md)

## 版本目标

把 MCP 页从“每位队员一张卡再打开无搜索下拉框”的短列表交互，升级为适合大量队员与大量
MCP 的主从分配工作台；同时把已安装 MCP 从 tofu 卡片墙收敛为与 Skill Library 同家族的
开放列表。用户可以先锁定队员、再搜索筛选和批量调整 MCP，也能从 Server 视角查看真实来源、
Endpoint、启停与队员范围。

## 交付范围

- 队员区使用受控 `MemberAvatar`、名称、角色与分配数量；名册在桌面双栏内独立纵向滚动，
  标题与列表之间不加横向分隔，普通行保持中性白底，仅当前行使用 Steel soft wash 与 2px 短轨；
  200% zoom / 窄宽下切为有界横向队员带，不让整个设置页随队员数量无限增高；
- MCP chooser 提供名称、Endpoint、Transport 与来源搜索，以及全部、已分配、未分配筛选；
  搜索固定在当前队员标题右侧，选项行不重复显示“已分配 / 未分配”，checkbox 即时保存，筛选
  结果可以批量选择或清空；页面不再重复显示“只影响后续新执行”胶囊或底部脚注；
- MCP 风险分类不进入普通设置 UI：不显示标签、筛选或额外确认 Dialog；显式勾选、启停和批量选择
  统一走同一 mutation 流程，并按 Core 返回的最新 `configDigest` 串行提交，保留既有 CAS 冲突恢复；
- 已安装 MCP 使用稳定 `serverId` 身份色 mark 和开放列表行，展示来源、Endpoint、真实队员头像
  摘要、启停与详情；编辑 JSON 和删除收进展开详情，不再形成意义不明的常驻操作栏；
- 保留标准 JSON 真源、Finder 入口、malformed fail-closed、权限修复、显式导入与
  AgentRun 冻结投影边界，不增加第二个配置真源或新的 IPC。

## 冻结边界

- 分配工作台只展示当前在队队员；不改变 Presence、成员生命周期或历史 AgentRun；
- “随机色”只指由稳定 `serverId` 确定的现有身份色 Token，刷新后不得改变，也不冒充 MCP 官方 Logo；
- Server Library 的队员摘要只读，唯一分配编辑入口仍在上方工作台，避免两套写入口竞争；
- `riskLevel` 与 `acknowledgeHighRisk` 继续作为 Core / IPC 兼容事实，但不形成 Renderer 的可见分类
  或额外步骤；用户触发分配或启停本身就是该 mutation 的明确意图；
- 不伪造连接健康、工具数量、Runtime 可用或保存成功；每次 mutation 仍以 Core 返回为准；
- 不改变 MCP Schema、标准 JSON 格式、导入安全规则、Runtime Projection 或已运行 AgentRun 的
  Exposure Snapshot。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.62 冻结为 historical，v0.63 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 确认无需更新 | 只替换既有 Renderer 关系编辑与列表呈现，不产生新的跨版本领域、持久化或进程决定 |
| Contracts | 确认无需更新 | 继续使用既有 MCP config、assignment mutation、CAS result 与 import IPC 字段 |
| Architecture | 确认无需更新 | JSON 真源、Core mutation、Renderer 图形编辑器与 Runtime Projection 职责不变 |
| UI | 已更新 | UI 索引与 Neutral Porcelain + Steel 详规冻结双栏工作台、长名册滚动、搜索筛选、稳定身份 mark 与开放列表 |
| Runtime Activity | 确认无需更新 | 不改变 AgentRun、Canonical Activity、Evidence 或执行过程展示 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime MCP 投影、Adapter 协议、实测版本或兼容性结论 |
| Documentation routing | 已更新 | 版本索引改由 v0.63 作为唯一 current；既有 MCP/UI 任务入口继续有效，无需新增顶层路由 |
| Root README | 确认无需更新 | 项目定位与常青能力不变，根 README 不记录局部设置页重构 |

## References

- [v0.63 实施与验收计划](implementation-plan.md)
- [Renderer UI 规范](../../ui/README.md)
- [设置工作区策略](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [v0.37 MCP 生产设计](../v0.37/production-design.md)
- [桌面 UI 验收与隔离数据](../../development/ui-acceptance.md)
