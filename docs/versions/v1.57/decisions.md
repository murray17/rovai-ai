---
document_type: version-decisions
version: v1.57
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-10
---

# v1.57 版本决定

<a id="v1-57-d01"></a>
## V1.57-D01：Host 准备有限元数据，分析 Agent 消费工作区报告

- 状态：accepted
- 日期：2026-09-10
- 当前权威：[Execution Evaluation v1](../../contracts/execution-evaluation-v1.md)、[User Automation v3](../../contracts/user-automation-v3.md)、[双轨执行评测](../../architecture/execution-evaluation.md)

每日分析需要跨 Run 统计，但受管 Agent 不拥有应用级用户身份。让它直接导出所有 Camp 数据，会穿过既有 User Automation OS denial 边界；新增数据库 provenance 和计数虽能提高覆盖，却要求所有执行入口、A2A 后代和迁移同时修改，超出首轮统计需要。

选择由 Main 在用户配置的范围内准备只读元数据与确定性报告，让现有 Automation 的 Agent 读取工作区中的有限输入。Core 不暴露正文查询或通用 SQL，统计与解释分别保留来源和状态。

代价是数据准备与分析可能先后失配，必须拒绝陈旧报告；旧记录不能完全识别 origin 或历史 build，Memory 计数也保持未知。该边界保留既有应用级身份与 Agent 身份隔离，未来补 provenance 时可以升级统计合同，不必给分析 Agent 开放用户控制面。
