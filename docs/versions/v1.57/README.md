---
document_type: version-overview
version: v1.57
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-10
---

# Rovai-ai v1.57：上下文 Gate 与双轨评测

前置：[v1.56](../v1.56/README.md)。本版本实现[四项治理愿景](../../research/agent-governance-vision.md)中的第二项：Gate／每周真实任务回归与每日 Trace 规则分析。长期规则见 [Execution Evaluation v6](../../contracts/execution-evaluation-v6.md)，操作见[开发指南](../../development/evaluation.md)。

## 范围与状态

本次后续预算、并行和真实 Judge 验证见[预算校准记录](evaluation-budget-calibration.md)。

评测指标和离线报告的后续修订范围、旧检查项映射与验收边界见[指标修订计划](evaluation-metrics-revision.md)。

宿主与定时执行接入、旧失败复核见[宿主接入计划](evaluation-host-integration.md)。该增量正在进行真实验收，不由流程单测推断全部 Case 通过。

复用 Qualification Runner、Case admission、合同测试、双 View Judge、Core 持久证据、用户 CLI 和 Rovai Automation。新增受限只读 Trace 导出、日报与曲线、Host 报告准备、两级 Gate 及每周报告历史。通用集 12 个 Case；Memory 与 Review Duo 各有 3 个专属 Case。没有专属集的其他 Skill 先补样本，不能默认为已覆盖。

本次没有新增数据库字段，Data Contract 98、Camp Snapshot 34、formatter/manifest 23 及 Built-in tool/context 语义保持。Memory 精确计数、文档体系重构和队员成长仍属后续项，日报中的两项 Memory 指标为未知。User Automation 新增 owner-only 元数据操作，不注入 Agent 上下文。

2026-09-10 开发者明确授权继续实现两条评测线，并授权实现者自行选择必要实现细节、最后汇总。本版本不修改核心模型可见机制或内置 Skill 内容，因此不触发产品模型上下文 revision；后续实际上下文／Skill 机制改动仍按 Gate 流程确认和验证。

代码及本地验证、隔离定时链路和首次真实 Judge 校准已运行；完整对照、独立保留集、固定模型 snapshot 与部分取证覆盖仍有缺口，版本状态保持 `in_progress`，详见[实施计划](implementation-plan.md)和[预算校准记录](evaluation-budget-calibration.md)。设计、Case 准入与合同测试不能证明任务质量提升；各类运行证据分别记录，不相互替代。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.56 冻结，本概览、实施计划及[版本索引](../README.md)建立唯一 current v1.57 |
| Decisions | 已更新 | [V1.57-D01](decisions.md#v1-57-d01)记录元数据与分析 Agent 的权限分离 |
| Contracts | 已更新 | [Execution Evaluation v6](../../contracts/execution-evaluation-v6.md)、[User Automation v4](../../contracts/user-automation-v4.md)及索引 |
| Architecture | 已更新 | [双轨执行评测](../../architecture/execution-evaluation.md)、User Automation 当前路由 |
| UI | 已更新 | 复用 Camp 与文件入口，增加离线 HTML、质量和协作对照；保留 SVG/Markdown/JSON，无 Renderer 或 App 沙箱改动 |
| Runtime Activity | 确认无需更新 | 只读取当前 classifier 既有证据，不修改分类、事件或 Activity 投影 |
| Runtime compatibility | 确认无需更新 | 复用现有 Runtime Adapter；局部评测验证不提升平台或 Runtime 资格 |
| Documentation routing | 已更新 | 文档导航、开发入口、上下文治理、Contracts、Architecture 与 CURRENT 纳入双轨评测 |
| Root README | 确认无需更新 | 项目定位与支持平台不变；开发评测操作由 development 入口拥有 |

评测证据采集、Judge 未知处理及报告结论修订见[证据与报告完整性修订](evaluation-evidence-completeness.md)。
