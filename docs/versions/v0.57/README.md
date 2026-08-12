---
document_type: version-overview
version: v0.57
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-11
---

# Rovai-ai v0.57：可恢复的项目侧栏移除

> 当前状态：交互边界、生产实现、自动化门禁与打包 App 验收已经完成。项目菜单新增“移除项目”，
> 其含义严格限定为从这台 Mac 的侧栏隐藏，不删除工作目录、Camp、消息、AgentRun 或审计。
>
> 前置版本：[v0.56 Neutral Porcelain + Steel Renderer](../v0.56/README.md)
>
> 后续版本：[v0.58 可恢复 Runtime 漂移与受控重绑定](../v0.58/README.md)

## 版本目标

让用户可以把不再需要长期显示的 directory Project 从统一侧栏移走，同时保留将来重新选择同一
工作目录即可恢复的路径。该动作是 Electron Desktop Shell 的本机导航偏好，不为 Project 建立
Core 生命周期，也不伪装成文件或 Camp 删除。

## 交付范围

- directory Project 三点菜单在“置顶项目 / 取消置顶项目”后以分隔线增加“移除项目”；Quick Chat
  不提供该动作，零 Camp 的已校验目录仍可移除；
- 确认 Dialog 明确说明只隐藏本机侧栏并取消该 Project 及其 Camp 的置顶，不会删除目录、Camp、
  消息、运行记录或审计，也不会停止正在运行的执行；
- Electron Main 将统一导航偏好升级为 schema 2，在 `userData/navigation.json` 原子保存 pins 与
  removed Projects；schema 1 的既有 pins 自动迁移且不丢失；
- 移除当前 Project 或其已打开 Camp 时回退 Quick Chat，并把 Main Window Session 的可恢复位置提交
  为 Quick Chat；确认完成后键盘焦点回到 Quick Chat 项目行；
- 重新选择同一工作目录、创建该目录的新对话，或从受信入口重新打开其中 Camp 时恢复 Project；
  恢复只取消隐藏记录，不自动恢复先前置顶；偏好写入失败不阻断 Camp 打开或创建；
- 单元测试与打包侧栏验收覆盖迁移、原子写入、确认/取消、置顶清理、跨重启隐藏、恢复、焦点和
  Core 数据不变。

## 冻结边界

- “移除项目”不调用文件系统删除，不删除或归档 Camp，不取消 AgentRun，不产生领域事件或审计；
- Project 仍由 Core Navigation Read Side 按 canonical directory path 动态聚合，不新增 Project 表、
  identity、tombstone、archive 或 lifecycle；
- `navigation.json` 只保存稳定 target key、时间与 pin，不复制标题、目录快照、Camp 正文或 Core 数据；
- 该动作可恢复，因此使用 Steel 主操作而不是 danger 红色；永久 Camp 删除仍保持独立 danger 语义；
- 不在侧栏新增“已移除项目”垃圾箱、恢复中心或重复入口，也不改变 Quick Chat 与 New Conversation
  的既有功能边界。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.56 冻结为 historical，v0.57 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 确认无需更新 | 本机可恢复导航偏好沿用既有 Electron Main 权威与原子私有 JSON 边界，不产生新的跨版本高成本架构决定 |
| Contracts | 确认无需更新 | 不改变 Core IPC Router、领域命令、Envelope、receipt 或持久数据合同；Preload 的应用内类型随实现原子演进 |
| Architecture | 确认无需更新 | Core Navigation Read Side、Renderer 投影与 Electron Main 偏好存储的职责边界不变 |
| UI | 已更新 | 当前 UI 详规和索引新增 Project 移除、确认、回退、恢复、焦点与非危险色义合同 |
| Runtime Activity | 确认无需更新 | 不改变 AgentRun、Canonical Activity、证据或执行控制；运行中的执行明确继续 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Product Runtime、版本、能力或实测结论 |
| Documentation routing | 已更新 | 版本索引、UI 规范与桌面侧栏验收共同指向 v0.57 当前范围 |
| Root README | 确认无需更新 | 项目定位、常青能力与支持范围不变，根 README 不记录局部导航偏好 |

## References

- [v0.57 实施与验收计划](implementation-plan.md)
- [当前 UI 详规：统一侧栏](../../ui/components/app-shell-navigation.md#统一侧栏结构)
- [桌面 UI 验收](../../development/ui-acceptance.md)
