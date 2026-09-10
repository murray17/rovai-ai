---
document_type: interface-contract
contract: semantic-judge-views
version: 2
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.57
last_updated: 2026-09-10
---

# Semantic Judge Views v2

v2 在 [v1](semantic-judge-views-v1.md) 的双 View、反序双副本、Evidence closure、精确模型配置、不可变保留与 HardOutcome non-interference 上，增加显式 `generic-task-v2` 回归 profile。未指定 profile 时继续使用原 v1 prompt、projection 与 categorical 输出；历史 artifact 可重建，不能悄悄改用新 rubric。

## 冻结 profile

Configuration 的 `taskProfile` 包含 version 和完整 items；每项只有 checklistItem、applicable、criterion，数量和 ID 对应原 Process 五项或 Outcome 七项。Profile 与新 rubric 进入 prompt/rubric digest，Configuration artifact identity 追加 profile digest，避免覆盖不同标准的旧配置。Envelope 和 Suite 的既有 reference shape 保持，语义版本由显式 profile 标识。

Model-Visible Pack 使用 `semantic-process-generic-task-pack-2` 或 `semantic-outcome-generic-task-pack-2`，case.acceptance 与冻结 profile 完全一致；replay 根据 sourcePack 和 Configuration 重建。使用两个相同 categorical 副本，不让 Judge 报分、投票或平均。分数仅由 [Execution Evaluation v2](execution-evaluation-v2.md) 的代码计算。

## 通用结果评价与证据隔离

原七个 ID 保留作追溯锚点；implementation.quality 表示本 Case 实际交付物质量，testing.strategy 表示本 Case 所需验证。结果 Judge 按冻结 criterion 区分代码、报告、结构化资料分析和方案比较，不要求非代码任务提供软件实现或测试套件。正确处理任务预设阻塞可以达成目标；缺少评测证据则 indeterminate。

Source Pack 既有历史 `code` segment 实际由有摘要绑定的 UTF-8 工作区交付物生成；新 Model-Visible Pack 将其命名为 artifact，将 codeSegmentId 投影为 artifactSegmentId。读取范围继续由原 Evidence Index、受控 workspace snapshot、内容上限与 safeForJudge 决定，不额外读取私有工具日志或未经绑定的输入文件。

结果 View 仍只包含公开任务、交付物、工作区变化、验证事实与最终响应，不加入成员、交接、调用次数、完整 Trace 或 HardOutcome。边界语义只能覆盖交付内容；工作区写入、A2A 上限、Memory 状态由独立规则提供结论，结果 Judge 不猜测“未越权”。若来源事实未进入受控证据，Judge 保留未知，不能仅用声明自证。

## 适用性与未执行

适用性由冻结 Case 配置决定，任何运行后临时 N/A 使 Replica 输出无效。配置 N/A 的项目要求 typed abstention；配置适用但零协作观察的项目为 unavailable，不能转为 N/A。所有项目为 N/A 时不调用 Process Judge；所有适用项目 unavailable 时也不调用，保留 typed unavailable artifacts。

完整权威零接纳事实是否构成关键协作未执行，由外层回归规则说明；Judge 原始 abstention 仍保留，不伪造成 LLM 判定。观测覆盖不完整则未知。

## 限制

任务通用的名称不等于任意任务已经得到验证；本次不扩充题库。报告任务是否具有充分事实依据，取决于实际保留证据，不由没有代码决定。两副本一致也不等于语义评价正确；独立真实验收仍须另行运行。
