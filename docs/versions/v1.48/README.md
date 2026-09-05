---
document_type: version-overview
version: v1.48
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-05
---

# Rovai-ai v1.48：Pi 原生执行边界收口

前置：[v1.47](../v1.47/README.md)。本版本保留 Pi JSONL RPC Host、Native Session、exact resume、结构化图片、
Fleet/LRU、correlated abort、无模型调用 Machine Ready 与 Preview/NotQualified 资格边界；只删除 Rovai 对 Pi 原生
Tool/Approval 的不完整再实现，并把 Runtime Input acceptance 收敛到 Pi 实际开始本轮的 `agent_start` 事件。

## 范围与当前状态

- Pi 固定以 `--mode rpc --no-themes --approve --extension` 启动；`--approve` 只授予本次进程 project trust，使 Pi
  原生 ResourceLoader 加载 Skills、Extensions、Context files、Prompt templates 与项目配置，不映射为 Rovai Approval。
- managed Extension 收敛为 v7：只上报 Session 状态，并在每个 `before_agent_start` 重新读取 binding、追加当前 Run
  Bootstrap。它不注册 Tool hook、输入 Receipt 或 Approval，不缓存上一位成员的 Bootstrap。
- Pi 的 Built-in/Extension Tools 与执行权限完全遵循 Pi 原生语义。Pi 不再提供 Rovai permission option、Approval、
  sandbox 或 Managed Input Receipt；公共 permission value 为空对象且执行时忽略。
- `prompt` response 只结束 RPC command round trip。第一个精确匹配当前 Host owner、Run、epoch、Prompt 与 Delivery 的
  `agent_start` 使用既有 Delivery transaction 原子接受输入并幂等发布一次 started；`agent_settled` 继续拥有终态。
- Migration 139 归一既有 Pi capability/profile/nonterminal Run permission 数据并退役新 acceptance 的 Receipt guard；
  历史 Receipt 表、行、UPDATE 不可变保护与父级删除 cascade 继续保留。
- External MCP 继续为 `Unsupported`，Pi 平台继续保持 Preview/NotQualified；本版本不以代码收敛替代真实 qualification。

## 保留边界

Session locator 隐私、exact resume、Host owner、binding generation、execution epoch、singleflight、Fleet/LRU、abort、
shutdown/reap、图片和 Usage 观察均不属于 Approval/Receipt，保持既有语义。Formatter 22 Prompt 不解析 Slash 或
`CURRENT_INPUT`，Bootstrap 内容与投递语义未改变，因此本版不是新的模型上下文 revision。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.47 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.48 |
| Decisions | 已更新 | [V1.48-D01](decisions.md#v1-48-d01)记录 Pi 原生执行与 Rovai Approval/Receipt 退役；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Runtime Launch and Verification v36](../../contracts/runtime-launch-and-verification-v36.md)替代 v35，定义单一原生启动、薄 Extension、`agent_start` admission 与历史 Receipt 边界 |
| Architecture | 已更新 | Runtime 基础不变量与 Catalog 同步 Pi project trust、原生 Tool、薄 Extension、无 permission options 与无 active Receipt 边界 |
| UI | 已更新 | [队员工作区 brief](../../../apps/desktop/.impeccable/surfaces/member-workspace.md)记录 Pi 不展示 Rovai Approval；既有 capability-driven Renderer 无需新增生产分支 |
| Runtime Activity | 已更新 | Pi Tool 继续映射原生结构化 lifecycle，但不再宣称 bash/edit/write 由 Rovai 审批 |
| Runtime compatibility | 已更新 | 历史实测证据保留；当前产品结论改为 native tools、无 permission options、无 active Receipt，平台仍 Preview/NotQualified |
| Documentation routing | 已更新 | 文档任务导航、Contracts 索引、版本指针和当前决定导航均指向 Runtime Launch v36 / v1.48 当前边界 |
| Root README | 确认无需更新 | 产品定位、安装方式和公开支持范围未变化；Pi 仍是 Preview/NotQualified |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Launch and Verification v36](../../contracts/runtime-launch-and-verification-v36.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [当前基础架构不变量](../../architecture/foundational-invariants.md)
- [Pi Runtime 重新接入 Parity Matrix](../../research/pi-runtime-reintegration-parity-matrix.md)
