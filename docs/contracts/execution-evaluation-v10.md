---
document_type: interface-contract
contract: execution-evaluation
version: 10
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.57
last_updated: 2026-09-11
---

# Execution Evaluation v10

v10 继承 [v9](execution-evaluation-v9.md)，使用 Suite 2.8.0 / scoring 2.6.0 / [Semantic Judge Views v8](semantic-judge-views-v8.md)。题目、Case seal、权重、硬验收与关键条件不变；不修改产品上下文、内置 Skill、普通用户数据或每日 Trace 口径。

## 并行与只读检查凭据

原生来源策略 `bound-native-command-witness-v2` 在 v1 的严格单命令之外，允许 2—4 个字面参数的 `Promise.all(exec_command)`，随后仅通过稳定分隔文字拼接各返回的原始 `output`。每个命令唯一、各输出只引用一次；拒绝动态参数、改写、重复、缺失或歧义分隔。完成事件可乱序，按精确命令绑定原生 item，再逐条校验已持久化 Core 摘要、工作区、退出码和输出后缀。

只有全部同组命令通过原有来源隔离检查，才保留包含完整并行返回的私有凭据；混合 Memory／Skill／业务调用整组拒绝。新增只读 Git status/diff、shasum/sha256sum 的候选采集，用于核对实际观察值。Git diff 的差异退出码不自动解释为检查失败，相关事实和执行声明按各自含义评价。旧 v1 策略仍不接纳这些扩展。

`judge-source-supplement-v2` 与 `bounded-evaluation-context-v3` 保留精确并行来源、命令序号与投影策略；所有旧记录和次数归属保持。重新评价只能增加 Judge 调用，不能增加真实 Runtime 样本。

## 对照与验证边界

在正式重评前，用有明确正反答案的合成样本验证：结果事实和恰当限制披露可判定；静默且被掩盖的明确命令成功声明仍未知；已有错误回执的成功声明仍失败。合成校准不计入 Case、任务质量或实际 Runtime 数据。

真实报告必须保留当前与旧标准结果、来源摘要、完整分项及覆盖、原始 Judge 响应、用量与包验证。若必需项仍未知或关键条件不满足，仍不能发布完整通过结论。独立保留集、固定服务端模型快照和基线对照仍须分别取得实际证据。
