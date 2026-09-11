---
document_type: interface-contract
contract: user-automation
version: 3
authority: desktop-user-automation-and-trace-export
status: accepted
source_version: v1.58
last_updated: 2026-09-10
---

# User Automation v3

## 继承与权限

完整继承 [v2](user-automation-v2.md) 的 Workspace、Transport、Diagnostic Trial 和 Runtime OS denial，只新增三项封闭用户 operation。IPC handshake 的 `contractVersion: 1` 不变，文档版本不是运输升级。Managed Runtime 仍不能调用 `rovai app`；不新增 Agent Built-in、审批实体或 generic Core invoke。

## Trace 导出

`rovai app trace export --since <RFC3339> --until <RFC3339> --output <new-directory>` 调用 Main `trace.export`，映射到 Core `executionTrace.export`。

完整参数为 `{ since, until, campIds: [], excludeCampIds: [], excludeAutomationIds: [] }`。日期必须有时区，区间为左闭右开、正数且至多 26 小时，导出时必须已经结束。各 ID 数组至多 100 项、ID 非空且最多 128 字符。未知字段拒绝。排除 Automation 经 CampTurn 所有权覆盖其 A2A 后代；普通用户 Automation 不自动排除。

Core 在同一只读数据库快照中导出 `schemaVersion: 1`、`window`、`scope`、`asOf`、`observedThroughGlobalSequence`、`exporter`、`coverage`、`factsDigest`、`facts` 与 `metrics`。`facts` 包含 Run、Delivery、窗口内终态／重试事件及当前 classifier 的可观测工具元数据。`exporter` 记录 Core package、Data Contract、projection schema、classifier，不能当成历史 Run 的 Rovai build。

每个事实数组最多 5,000 行，整个包最多 3 MiB；超过上限返回 `trace_export_limit_exceeded`，不得以截断数据生成完整报告。CLI 只创建新的私有输出目录，写入 `trace.json`、`metrics.json` 与 README。

不导出消息、Prompt、记忆正文、原始工具正文、credential、环境值、工作区路径或任意 SQL 结果。工具仅按 `run + epoch + operation + current classifier` 读取 Canonical Activity；Core 与 Runtime 来源缺少统一关联，分别报告且不可相加。Core 操作优先使用同一逻辑操作的原始终态证据，后来的回放不迁移原始计数日期；只有回放而无原始证据的条目排除；无法判断回放的条目独列为未知。

统计口径由 [Execution Evaluation v1](execution-evaluation-v1.md) 拥有。非法区间、非法范围、未来区间、无法解释的时间或容量超限都失败，不生成通过结论。

## 每日分析配置

`rovai app trace schedule` 调用 `trace.schedule`，只配置 Host 准备日报的范围，不创建 Automation 或发送消息。参数为 `{ automationId, timezone, output, campIds: [], excludeCampIds: [], excludeAutomationIds: [] }`；CLI 使用 `--automation-id`、`--timezone`、`--output` 和与导出相同的范围 flags。

Automation 必须已存在且绑定目录；`output` 必须是其工作区内部的绝对目录，不能解析为外部 symlink。Host 最多保存八份配置，ID 数组各至多 90 项。配置位于已受 OS denial 保护的 User Automation 私有目录；不写入数据库列，不让 Agent 更改导出授权范围。Host 自动排除所有已注册分析 Automation，额外回归／Smoke／开发任务由用户配置 ID 排除或运行在隔离数据库。

Main 复用现有 Scheduler tick 唤醒准备器，最多每分钟检查一次、同一服务串行执行；失败退避一小时，不阻塞正常 Automation 派发。成功的同日同范围日报冻结，重复 tick 不再次导出。Automation 关闭后停止准备；App 退出、休眠或 Core 不可用时没有常驻后台保证。分析 Agent 必须用 `eval-daily prepared` 核验昨日、时区及可用状态，不得把旧文件当作新日报。

`rovai app trace schedules` 调用 `trace.schedules`，返回配置及最近准备状态；失败、停用、范围变化均可见。配置范围改变需使用新的输出目录，避免把不同总体接成同一曲线。
