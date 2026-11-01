---
document_type: interface-contract
contract: execution-evaluation
version: 16
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.72
last_updated: 2026-10-30
---

# Execution Evaluation v16

继承 [v15](execution-evaluation-v15.md)，补齐当前 Regression Runtime 准入和所有适用指标的采集完整性。
Suite、Case、评分 2.10.0、权重和 Judge 判定语义不变。此修复不改变产品模型上下文或日常持久化。

## 当前 Runtime 的回归准入

隔离 Regression 可以使用 enabled、pathState=valid 且具有显式可执行路径的默认安装。
静态安装、`light_ready` 或延后 deep check 不等于探测成功；真实执行仍由 Core 的启动准入处理。
Runner 记录实际文件摘要，缺失的 Runtime 版本和能力为 null，probeStatus 保留已观测值或
`installed_unverified`，不通过轮询等待一个不会产生的旧 snapshot。非 Regression 的既有 Formal
准入保持。执行环境仍由真实成员配置、文件身份、能力与隔离证据绑定。

## 指标采集汇总

`assessment.arms.<arm>.collection` 从同一报告的计划 Trial 与逐项判定派生，不拥有独立评分逻辑：

- `status`：任一适用指标未形成有效判定时为 `incomplete`，否则为 `complete`。
- `quality`、`collaboration`：各自包含 `planned`、`applicable`、`evaluated`、`unknown`、
  `notApplicable`、`coverage: { numerator, denominator, value }` 和 `status`。
- `satisfied`、`partially_satisfied`、`not_satisfied` 都计入 evaluated；未知、遗漏、协议错误和
  未运行不计入。只有冻结的 applicable=false 才能从适用分母排除。
- 分项零适用分母的 status 为 `not_applicable`，coverage.value 为 null，不能显示 100%。
- `gaps[]` 逐项保留 caseId、repeat、section、itemId、checklistItem 和 reasonCode。

该覆盖率按检查个数统计；现有质量 coverage 仍按冻结权重统计，二者不可互换。完整采集不表示任务
验收通过、质量满分、基线可比或服务端模型 snapshot 已固定。当前通用集单次重复有 112 个适用质量检查
和 17 个适用协作检查；实现按冻结配置计算，不硬编码这两个数量。

所有适用协作项的未知都阻断评价完整性。关键项沿用现有缺口记录；非关键项使用
`collaboration_evaluation_incomplete`。可归因于 Judge 执行的缺口仍由 evaluationFailures 单列，
collection.gaps 同时保留对应指标，不能因故障分类而从采集分母消失。

HTML 展示已保存的汇总与缺口，不重新评分。旧报告缺少 collection 时不推测补写其 JSON。
未完成 Trial 的原因从保留的 Runner 错误提取，保持任务失败与执行设施失败的区分。

## 当前原生验证回执

`generic-task-v12` 的补充采集使用 `bound-native-command-witness-v3`，仍遵循
[Semantic Judge Views v12](semantic-judge-views-v12.md) 的判分和 Outcome／Process 分离：

- 原生 `thread/read` 的命令公开字段必须能重建当前 Core lifecycle 输入／结果载荷，包含结果摘要，
  并与已持久化的完整 payloadDigest 相等。旧公开字段形状仅在原摘要精确匹配时接受，不做子集匹配。
- 完成事件的全部 argv、工作区、命令 ID、退出码与对应载荷绑定；观察到的输出须与原生结果一致。
  明确观测的空字符串可以补回静默检查，缺失或 null 不能推断为空。并行调用同样逐命令绑定。
- 只解析原生调用包装的无修改数据流；省略 workdir 时仍要求原生命令的 cwd 等于隔离工作区。
  原生终态事件可直接证明其自身已绑定的输出，不依赖 Agent 怎样拼接工具展示文本。
- Git 状态、差异和文件哈希与现有测试命令一起进入有界回执。含协作元数据的生成脚本可只披露安全输出，
  标记 `commandRedacted` 和 `requiresOutputWitness`；不能据此证明被隐去的具体命令身份。
- 只有精确匹配的末尾字面量 public-only send 及结构化发送回执才允许分离验证前缀。
  发送正文、收件关系和回执不进入 Outcome；前缀标记 `requiresOutputWitness`，不得用整个 shell 的
  退出码证明前面的检查成功。成功声明须引用能支撑该检查的真实输出。
- 对 JSON 回执先解码字符串再脱敏，避免将 Python 语句后的转义换行误识别为 Windows 私有路径。
  原始证据、摘要和所有真正的脱敏缺口保留。

这些修复补足证据，不把未知直接转为满足或零分。采用修订后的评测器重新冻结，保留先前整轮和协议失败；
诊断性历史重评与新增任务执行分别记账，不用历史重评冒充新的每周样本。
