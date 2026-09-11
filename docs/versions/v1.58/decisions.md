---
document_type: version-decisions
version: v1.58
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-10
---

# v1.58 版本决定

<a id="v1-58-d02"></a>
## V1.58-D02：结果声明读取独立来源材料，不扩大为完整过程评审

- 状态：accepted
- 日期：2026-09-11
- 当前权威：[Semantic Judge Views v10](../../contracts/semantic-judge-views-v10.md)、[双轨执行评测](../../architecture/execution-evaluation.md)

完成回复可能引用来源原文和长度。只给结果 Judge 产物会遗漏这类核验依据；给全部 Trace 会破坏过程隔离。选择把同一隔离 Camp 的派发前用户正文和根请求作为独立未可信材料，验证实际快照、派发身份、正文摘要、长度和冻结输入的存在性。来源保留边界、匿名引用和脱敏状态，不认证模型行为。

代价是来源预算不足时必须明确阻断这次评价，不能静默截断。来源类目前限于用户 Camp 消息；外部网页、文件附件和记忆正文仍需各自的授权、版本与来源合同，不能宣称任意声明都一定可核验。

<a id="v1-58-d01"></a>
## V1.58-D01：Host 准备有限元数据，分析 Agent 消费工作区报告

- 状态：accepted
- 日期：2026-09-10
- 当前权威：[Execution Evaluation v1](../../contracts/execution-evaluation-v1.md)、[User Automation v3](../../contracts/user-automation-v3.md)、[双轨执行评测](../../architecture/execution-evaluation.md)

每日分析需要跨 Run 统计，但受管 Agent 不拥有应用级用户身份。让它直接导出所有 Camp 数据，会穿过既有 User Automation OS denial 边界；新增数据库 provenance 和计数虽能提高覆盖，却要求所有执行入口、A2A 后代和迁移同时修改，超出首轮统计需要。

选择由 Main 在用户配置的范围内准备只读元数据与确定性报告，让现有 Automation 的 Agent 读取工作区中的有限输入。Core 不暴露正文查询或通用 SQL，统计与解释分别保留来源和状态。

代价是数据准备与分析可能先后失配，必须拒绝陈旧报告；旧记录不能完全识别 origin 或历史 build，Memory 计数也保持未知。该边界保留既有应用级身份与 Agent 身份隔离，未来补 provenance 时可以升级统计合同，不必给分析 Agent 开放用户控制面。
