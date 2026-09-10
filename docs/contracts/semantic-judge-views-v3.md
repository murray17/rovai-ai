---
document_type: interface-contract
contract: semantic-judge-views
version: 3
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.57
last_updated: 2026-09-10
---

# Semantic Judge Views v3

v3 继承 [v2](semantic-judge-views-v2.md)，新增显式 `generic-task-v3` profile，修正证据可见范围及未知的处理。旧 profile、旧配置及历史结果不变；本次不修改产品模型上下文或 Skill。

## 受控证据补全

评分配置预先声明 `evidenceFiles`，至多 64 个唯一安全相对路径。Runner 将最终受控工作区的文件摘要登记到 Evidence Index；语义导出只读取声明范围内、有 safeForJudge 索引和摘要绑定的 UTF-8 文件，包含没有被改动的输入和原始实现。拒绝目录逃逸、符号链接与摘要不匹配，单段限 50,000 字符，新增段合计限 150,000 字符；缺失、二进制或超限的材料不构成已观察事实。任务成功不由“修改过文件”推断。

同一 Camp Turn 内属于本 Trial AgentRun 的公开成员消息可进入 Process View，包括 Gather 返回。消息正文须同时匹配完整 observations 文件、快照及 Evidence Index 的摘要。不读取私有思维或未经绑定的 Runtime 工具日志；这些日志没有被保留时，不能证明 Agent 执行了某条命令。

Outcome 仍只看任务、受控交付物、规则事实和最终响应，不接收成员消息、协作调用数量或完整 Trace。新增文件以 artifact 投影，输入和任务产物都按不可信数据处理，不能成为 Judge 指令。

## 引用和错误定位

模型可见 policy 为 `semantic-process-generic-task-pack-3` / `semantic-outcome-generic-task-pack-3`。每项可引用同一 View 内的已准入证据 ID；ID 是引用许可，不表示该证据自动支持判断，Judge 必须说明相关性。不得跨 View 引用或扩展证据集。

一份副本必须包含精确的 checklist，缺项、重复项及整体结构无效仍使整份副本不可用。结构完整但某个适用项的格式或引用无效时，仅该项归为 `indeterminate` 并标明 evaluator rejection，保留原始提供方输出；其他合法项继续保留。不可将无效输出转成成功、失败或重新生成更高分。预先不适用项的非法输出仍拒绝。反序双副本和分歧为未知保持。

## 评价标准

v3 rubric 和 Case criterion 一同冻结并进入摘要。目标达成看实际结果；指出缺陷或提出修复建议不等于完成修复。验证器的测试是产物事实，不能证明 Agent 自己运行过某条命令。

声明与证据明确矛盾时按影响评为部分满足或不满足；缺少支持或反驳材料时为未知，不能以“没看见”为由给半分。只声称完成审查不等于声称完成修复；是否满足整个任务由目标项独立判断。限制披露不要求 Agent 预知评测导出的缺口。

协作整合检查公开贡献是否反映在结果、合理解决或说明未采用原因，不要求证明内部思维因果关系。判断一致不等于客观正确，同模型双副本也不是独立模型共识。
