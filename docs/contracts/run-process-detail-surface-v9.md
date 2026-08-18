---
document_type: renderer-contract
contract: run-process-detail-surface-v9
authority: agent-process-detail-placement-and-recovery-surface
status: accepted
last_updated: 2026-08-18
---

# Run Process Detail Surface v9（Runtime 失败归因）

本合同完整继承 [Run Process Detail Surface v8](run-process-detail-surface-v8.md) 的执行台位置、完整 Tool
chronology、Built-in 公共结果、原位复制、cancelled/stopped、Recovery Blocker 与 planned-shutdown 诚实
投影，并增加 Claude Code 与 Antigravity 的公开失败呈现。

## 1. AgentRun failure

failed `AgentRunView` 的 `failure` 非空时，执行台必须显示 Runtime 名称、`summary` 和可选 `detail`。即使
该 Run 没有 Execution Evidence，也不能被既有 empty-detail early return 隐藏；失败详情默认展开。标题只由
Core 提供的 `origin` 与 `runtimeKind` 映射：

| origin | Claude Code | Antigravity |
| --- | --- | --- |
| `runtime` | Claude Code 返回错误 | Antigravity 返回错误 |
| `compatibility` | Claude Code 与当前 Rovai 版本不兼容 | Antigravity 与当前 Rovai 版本不兼容 |
| `environment` | Claude Code 的本机运行环境不可用 | Antigravity 的本机运行环境不可用 |
| `rovai` | Rovai 内部错误 | Rovai 内部错误 |
| `unknown` | Claude Code 未能完成运行 | Antigravity 未能完成运行 |

Renderer 不读取内部 `error_detail`、stderr、日志或 digest，不从 `code/detail` 文本猜 origin。只有
`origin=rovai` 可以显示“Rovai 内部错误”。长 summary/detail 必须换行且不使执行台产生横向 overflow。

## 2. Runtime 设置

Runtime 设置页保留既有 `authentication_required / incompatible / needs_attention / path_missing` 等状态徽标。
当 Claude/Agy `ProductRuntimeAvailability.failure` 非空时，同一 Runtime 行在状态之外显示上述 origin 标题、
summary 与可选 detail，不再只显示“需要处理”或“最近一次 Runtime 验证未完成”。检查按钮、focus、列表
位置和其他 Runtime 行保持不变。

启动浅检测不提供 failure 时继续显示既有 machine-state copy；last-known-good 刷新失败继续显示缓存可用，
Renderer 不制造产品级 Runtime failure。Day/Night 共用同一 DOM，runtime/rovai 使用 danger、compatibility/
environment 使用 attention、unknown 使用 neutral token，并始终以文字而非颜色表达归因。

## 3. 验收

- Claude/Agy 的五种 origin 标题逐项精确；只有 rovai 分支包含“Rovai 内部错误”；
- 无 Evidence 的 failed Run 仍渲染并展开 failure；
- Runtime 设置页同时显示既有状态与安全 failure summary/detail；
- 长 CJK/英文 detail 可换行，双主题、200% zoom 与窄执行 Inspector 不横向溢出；
- 其他 Runtime 不获得新的 failure UI 或推断逻辑。

## References

- [Run Process Detail Surface v8（历史）](run-process-detail-surface-v8.md)
- [Runtime Launch and Verification v9](runtime-launch-and-verification-v9.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
