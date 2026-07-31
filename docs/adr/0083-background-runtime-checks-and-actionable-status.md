---
document_type: adr
id: ADR-0083
title: Background Runtime Checks and Actionable User Status
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.26
supersedes: []
superseded_by: null
---

# ADR-0083: Background Runtime Checks and Actionable User Status

## Context

Runtime Discovery、版本读取、认证与能力探测、可执行文件完整性检查和成员配置校验是不同
成本、不同权威的内部阶段。把“已找到”“尚未检查”“已检查”等阶段直接展示给用户，不能
回答 Agent 运行时是否可用，也不能说明用户下一步应做什么。

如果成员配置页面在打开、切换或保存时同步执行完整探测，CLI 启动、登录状态读取、模型
目录和 fingerprint 计算还会阻塞普通表单交互。另一方面，完全依赖用户手动检查会让缓存
在 Core 长时间运行期间过期，并推迟发现安装、更新和文件身份变化。

本决策局部替代 ADR-0066 第 3、5、7、9 节中“未登记候选默认不深度探测”、成员选择后
同步解析及用户界面展示发现/探测阶段的条款。ADR-0066 的产品目录、Search Environment、
Managed Default Installation、验证后迁移和 Native Session 兼容边界继续有效。
ADR-0075、ADR-0076 的消息优先与执行前轻量完整性确认继续有效。

## Decision

### Core 统一拥有发现、检查和缓存

Core 保留完整的 Runtime Discovery、Probe Attempt、Capability Snapshot、Readiness 和
退避状态机。Renderer 不建立第二份检查状态，也不从路径、版本或错误文本自行判断能否
执行。

最近一次成功 Capability Snapshot 和 Probe Attempt 继续持久化。时间到期但文件身份
未硬失效的成功快照在后台刷新期间仍可使用；失败尝试不得覆盖最近成功证据。路径、
fingerprint、认证、协议或必要能力硬失效时不得继续把旧快照投影为可用。

### 完整检查只在后台调度

Core 使用按 Product Runtime 去重的后台调度器，在以下边界排队检查：

- Core ready 后的初始发现完成；
- 后续 Runtime Discovery 或显式重新扫描完成；
- Runtime 安装、更新、受管迁移或已登记启动入口变化；
- 执行边界发现路径或轻量文件身份变化；
- 用户在成员配置中切换 Product Runtime；
- 已登记 Runtime 的最近成功检查超过 24 小时且不在退避期；
- 用户显式请求检查。

检查任务不进入交互请求串行队列，不持有 Renderer 草稿，也不改变已经冻结的 AgentRun。
同一 Runtime 的重复触发合并为一项在途工作。

### 页面读取缓存并按需触发刷新

成员配置页和 Agent 运行时设置页打开时立即读取最近缓存。所选 Runtime 或目录项缺少结果、
结果过期或已硬失效时，Renderer 只发送轻量 `ensure` 信号；Core 决定是否排队检查并通过
事件发布结果。页面不等待检查即可编辑身份、模型、权限和其他参数。

切换 Product Runtime 会立即替换本地草稿并请求一次后台检查。保存成员配置只在 SQLite
事务中使用当前缓存 Snapshot 校验 Product Runtime、模型和原生权限；不得同步执行
Discovery、CLI 深度探测或完整 fingerprint。缓存不足时仍沿用 ADR-0082 的
`AdapterKind`-only unresolved 保存例外。

AgentRun 启动前继续只做 ADR-0075、ADR-0076 定义的轻量文件身份和持久状态确认；只有
轻量身份变化或证据缺失时才在调度边界计算完整 fingerprint。

### 用户状态只表达结果和动作

Renderer 只使用以下主状态：

- `正在检查…`
- `可用`
- `需要登录`
- `未安装`
- `版本不支持`
- `不可用`
- `暂时无法确认`

未选择 Product Runtime 时显示“未配置 Agent 运行时”。`found_uninspected`、`checking`、
Discovery 状态、Probe Attempt 状态和 Snapshot 生命周期仍可作为 Core/诊断数据，但
普通 UI 不得展示“已找到”“尚未检查”“已找到，尚未检查”或“已检查”。

主状态每次只显示一个。具体版本、最近刷新失败、配置失效原因和修复入口作为次级说明
展示。存在仍可用的最近成功快照时，后台刷新不能把主状态从“可用”降为“正在检查”。

## Consequences

- 页面打开、Runtime 切换和保存不再等待 CLI 深度探测。
- 用户看到的是可执行结果和修复动作，而不是 Core 内部阶段。
- Core 需要维护后台队列、去重、事件刷新、周期过期检查和安全退出。
- 初始发现后可能并行启动多个已找到 Runtime 的隔离探测，但不会阻塞 Core ready 或普通
  IPC；Adapter 仍必须保持有界超时、无 TTY、私有工作目录和完整进程树终止。
- 最近成功缓存提高可用性，但 Renderer 必须明确展示刷新失败的次级说明，不能声称新
  检查已经成功。

## Rejected Alternatives

- **只替换 Renderer 文案。** Core 仍会在保存或页面交互中同步探测，不能解决阻塞。
- **删除内部发现与检查阶段。** 会丢失诊断、退避、迁移和恢复所需证据。
- **没有缓存时显示“已找到”。** 仍不能说明是否可执行或下一步操作。
- **后台刷新时统一显示“正在检查”。** 会隐藏仍可用的最近成功证据并制造无谓停机感。
- **保存前始终重新完整检查。** 把外部 CLI 与文件 I/O 重新放回表单提交热路径。
- **执行前重新深度探测。** 会把模型目录、认证握手和 Session 创建成本放入每次启动，
  也重复 ADR-0075 已移除的高成本检查。

## References

- [v0.26 Member Runtime Parameters](../versions/v0.26/README.md)
- [ADR-0066: Managed Product Runtime Discovery](0066-managed-product-runtime-resolution.md)
- [ADR-0075: Runtime Integrity at Change and Execution Boundaries](0075-runtime-integrity-at-change-and-execution-boundaries.md)
- [ADR-0076: Message-First AgentRun Dispatch Boundary](0076-message-first-agent-run-dispatch-boundary.md)
- [ADR-0082: Member-Owned Runtime Parameters](0082-member-owned-runtime-parameters.md)
