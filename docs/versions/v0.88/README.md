---
document_type: version-overview
version: v0.88
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-16
---

# Rovai-ai v0.88：Camp 世界地图环境片段与全局闲时调度

> 当前状态：设计、实现、自动回归与隔离世界地图 UI 验收均已完成。
>
> 前置版本：[v0.87 TRAE 静态检测与执行期验证](../v0.87/README.md)

## 版本目标

把 Camp 世界地图现有的随机词槽拼句改为受审阅的 120 条环境片段，并用一个 Camp 级全局调度器呈现
可信、低干扰、可复现的闲时叙事。角色移动途中只能描述途中所见；静止时优先使用地点专属片段；任何
真实执行、结果待确认或 A2A 会合事实始终拥有更高权威并立即撤下闲时事件。

本版本不改变 AgentRun、Runtime Activity、A2A、Delivery 或 Task 的 Core 权威，也不把地图瞬时位置、
偶遇或环境片段写回持久层。地图闲时事件仍是 Renderer-only 的非权威投影。

## 交付范围

- 以强类型 catalog 保存 80 条地点专属、24 条通用单人和 16 条双人偶遇片段；`kind` 表示
  `solo | encounter`，`topic` 表示主语义，节点、环境和运动适用范围由判别联合约束；
- 删除三个词槽数组和组合生成器；移动角色只从 6 条 `moving` 通用单人片段选择；静止角色在同时存在
  两类候选时按 70% 地点专属、30% 通用内容分支；
- 一个 Camp 只运行一个独立 `setTimeout` 调度器和一条按 Camp 播种的独立 PRNG 流：首次尝试 6–12 秒，
  后续按事件开始到下次尝试 22–34 秒，事件显示 5.6 秒；
- 所有单人和偶遇参与者共享至少 55 秒冷却；同一规范化 pair 额外至少 120 秒冷却；偶遇只在存在合格
  同节点静止 pair 时，以单次条件抽样约占闲时尝试的 10%；
- 保存最近 12 个全局 `beatId` 并维护节点近期历史；身份、运动、位置、权威 speech、冷却、相邻同 ID 和
  相邻同 topic 是不可放宽硬约束，只有全局与节点历史按固定层级逐步缩短；
- 先按最久未展示公平选择参与者或 pair，再选择片段；所有候选排序稳定，随机值可注入以支持确定性测试；
- Camp 切换、失焦或离开地图清空当前事件和调度状态，恢复后重新等待且不补播；过期的调度与展示计时器
  必须由 generation guard 拒绝修改新 Camp 或新事件；
- 静止单人和偶遇展示时暂停普通 ambient wandering；移动单人在路线结束时撤下；节点条件失效、强制移动、
  真实执行、结果待确认或真实 A2A 出现时立即取消；
- `sceneActive` 与 `motionActive` 分离；`prefers-reduced-motion` 只关闭动画，不关闭静态环境片段；
- 底部仲裁顺序固定为 `real > waiting > encounter ambient > solo ambient`。紧凑布局统一使用底部字幕；
  7 人及以上可保留真实气泡，但在没有真实播报时用 waiting/ambient 字幕回退，不再直接隐藏闲时内容；
- 普通闲时气泡只显示正文；紧凑/拥挤底部字幕保留“闲时 · 环境预设”或“闲时预设 · 偶遇”来源标签。
  偶遇使用单个共享气泡，不复用真实 A2A rendezvous 状态、颜色、视觉语义或临时头像位移；
- 角色位置以合成层 transform 更新，路径长度与 DOM ref 稳定缓存，避免逐帧布局写入和快照刷新造成抖动；
- 扩展 selector、调度器和 UI 的确定性测试，并扩展 `accept:world-map-ui` 的全 idle、reduced motion、
  condensed、crowded 与可控 encounter 场景。

## 明确不做

- 不修改 120 条已接受正文，不从角色设定、任务或 Runtime 输出生成环境片段；
- 不新增 Core 字段、IPC、持久化、Domain Event、Runtime transport 或 A2A 合同；
- 不把闲时偶遇解释为真实协作、消息投递、任务推进或成功证据；
- 不重做 Camp 世界地图视觉世界，也不改变常规时间线、Composer、Approval 或执行台权威。

## 验收边界

- catalog 必须精确为 120 条且 ID、正文唯一；80/24/16、每节点 8 条、6 条 moving、标点、grapheme
  长度上限和角色无关性均由确定性测试验证；
- selector 必须验证地点/环境/运动过滤、70/30 与条件式 10% 的边界值、一次抽样、参与者公平、硬约束、
  固定软历史层级、相邻 ID/topic 去重及候选耗尽后安全跳过；
- 调度器必须验证 6–12 秒、22–34 秒、5.6 秒、55/120 秒、无候选、权威中断、失焦恢复、Camp 切换及
  两类 stale callback；
- UI 必须验证 reduced motion 仍显示静态片段、紧凑/拥挤字幕回退、偶遇只有一个共享气泡，以及真实与
  waiting 文案优先级；
- 通过类型检查、相关单元测试、文档治理和世界地图 UI acceptance；自动化无法覆盖的 day/night、最小窗口、
  200% 缩放和视觉层级需留下人工验收记录。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.87 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.88。 |
| ADR | 确认无需更新 | 本版本是可逆的 Renderer 局部调度与呈现细化，不改变跨版本权威、持久化或协作语义。 |
| Contracts | 确认无需更新 | 不改变 Core/IPC/Runtime 字段、Envelope、receipt、错误或投递语义；环境片段只存在于 Renderer。 |
| Architecture | 确认无需更新 | Camp 世界地图继续消费既有只读投影；全局调度器没有形成新的进程、传输或跨模块权威边界。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)记录环境片段、全局调度、权威优先级、reduced motion 与紧凑/拥挤回退合同。 |
| Runtime Activity | 确认无需更新 | Runtime Activity canonical mapping、证据和真实播报内容不变；本版本只确保其覆盖 Renderer 闲时事件。 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Product Runtime 的能力、版本或兼容性结论。 |
| Documentation routing | 已更新 | [版本索引](../README.md)切换到 v0.88；现有架构、合同与任务入口职责不变。 |
| Root README | 确认无需更新 | 项目定位、常青能力和公开支持范围不因地图 Renderer 闲时体验细化而变化。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Camp 会话工作区 UI 合同](../../ui/components/conversation-workspace.md)
- [世界地图组件](../../../apps/desktop/src/renderer/src/CampWorldMap.tsx)
