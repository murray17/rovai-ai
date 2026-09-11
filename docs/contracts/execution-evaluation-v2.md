---
document_type: interface-contract
contract: execution-evaluation
version: 2
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.58
last_updated: 2026-09-10
---

# Execution Evaluation v2

v2 保留 [v1](execution-evaluation-v1.md) 的两条证据链、隔离执行、冻结方案、二次确认、分层选例、合同验收、预算、全部尝试保留和 owner-only Trace 边界；以下条款拥有新执行的评分、比较和报告语义。产品上下文、Case 题目、Runtime 权限与数据库字段不变。

## 通用任务质量

回归目录的 `scoring-v2.json` 是执行前冻结的配置，`generic-task-quality@2.0.0` 初始权重为目标达成 50、证据一致性 25、边界遵守 25。它们是尚未实测校准的初始权重。每个 Case 声明固定权重、细项、适用性、细项权重、具体验收依据和唯一判定来源：Outcome Judge、既有硬检查或专项规则。题目与评分分别摘要绑定；Case seals 不因报告改名而重做。

| 维度 | 旧检查项与新职责 |
| --- | --- |
| 目标达成 | requirements.understanding、design.solution_fit、implementation.quality、testing.strategy；依据本 Case 的实际产物与目标，非代码任务不要求代码或测试套件 |
| 证据一致性 | response.claim_accuracy、response.limitations；完成声明、产物与验证事实一致，任务未知与评测证据缺失分开 |
| 边界遵守 | scope.discipline 只评价交付内容中的指令、范围与信息适用性；工作区、A2A 上限与 Memory 状态使用各自权威规则，不让结果 Judge 猜测过程 |

满足、部分满足、不满足分别转为 1、0.5、0。缺失、未运行、Judge 分歧、indeterminate 和临时宣称 N/A 均为未知。只有预先配置的不适用项可排除，且只在所属维度内归一化；三个上层维度的权重不转移。相同检查不能以规则与 Judge 两个来源重复加权。

代码先在每次 Trial 内按适用细项权重计算维度分（0–100），再在同一 Case 的计划 repetition 内等权，最后按固定 Case 权重汇总。总质量是三个维度分按 50/25/25 加权。必需项未知时，其维度分和完整总分为 null，保留已完成维度、逐项状态及加权覆盖率。未知的权重留在覆盖分母，不填零或从分母删除。

初版不设置总分下限或统一模块 80% 下限；配置 `minimumQuality=null`、`maximumItemDowngrade=0`。阈值若需调整，先用独立校准样本解释依据、升级配置并冻结，不能查看候选失败后临时改标准。

## 协作分项统计

保留五个 Process 原始判定、两副本理由及 Evidence references：delegation 为协调必要性；handoff_clarity 为信息交接充分性；contribution_value、feedback_absorption、lead_integration 为贡献整合有效性。无协作总分，不与质量相加。

统计单位是计划 Case × repetition，基线、候选各自汇总。每项及每组保存计划 Trial 数、适用 Trial 数、独立 Case 数、独立适用 Case 数、五态数量及未知原因分类。适用计划数 = 满足 + 部分满足 + 不满足 + 未知；四态比例分别除以适用计划数。未知保留分母；部分满足不计成功；零分母 value=null，显示 N/A。

多个细项按预先声明适用项汇总：任一不满足 → 不满足；否则任一未知 → 未知；否则任一部分满足 → 部分满足；否则全部满足 → 满足；没有适用项 → 不适用。此规则版本为 `failure_unknown_partial_satisfied_v1`。分组失败不抹去细项未知，另存 `trialsWithEvidenceGaps` 与原因；分组未知率不能称为完整评价覆盖率。

适用性来自配置，不来自运行结果。要求协作而未执行时，完整权威零交接证据产生 `required_collaboration_not_executed`，来源明确标为 rule，原始 Judge abstention 保留；没有完整观察证据则未知。预先独立交付的任务可 N/A；实际不必要调用仍受 A2A 规则约束。

Case 关键项必须满足：不满足与部分满足均阻止放行；关键项未知属于证据不足。分别按 Trial 去重统计关键不满足、部分满足、未知及受阻数量；一个 Trial 可以同时出现在不同类别，明细保留全部关键项。

## Gate、比较与历史

沿用硬性验收 → Case 关键条件 → 新旧逐项退化与质量对照的顺序。已知候选硬失败不能被其他缺失或高分冲销。质量分完整不代表 Gate 通过。非关键过程诊断保留未知分布，不用一个综合协作阈值代替 Case 的关键条件。

只比较同一冻结计划里的 Case、repeat、适用性、标准与可比较环境。逐项记录判定退化、改善、已有问题、证据变化、无变化或不可比；质量差用分数，协作满足率差用百分点。未知不作为已确认退化。平均改善不覆盖单项退化或关键 Case 失败。候选验收失败与有合格基线支持的新退化分别说明。

repetition 是计划重复，attempt 是修复后的整次尝试。每个 campaign 最多两次 attempt，后次仍使用冻结标准与预算；不能追加分母、拼接最优 Trial 或清除失败来重置次数。后续 Agent 可在已确认语义范围内修正实现并重跑，退出条件是完整 Gate 通过，不能只追质量分。每周例行运行只观察当前版本；它本身不授权改动产品上下文。

报告 schemaVersion=2，保留评分完整摘要、方案、产品代码与二进制、Judge、环境、所有计划 slots、质量与协作 assessment。每周 JSON 记录全部尝试，趋势只用首次尝试。整轮未运行、缺周、零分母、评分或环境不可比时断线。旧报告不换算新分数、不被覆盖、不跨口径连线；重新评价两边必须使用同一新 profile，证据不足时重新执行。

## 每日运行健康

沿用 v1 的自然日、作用域、去重、采集时点、Core/Runtime 分离与 Memory 两个未知计数。Core 统计定义仍为 definitionVersion=2；派生日报为 reportDefinitionVersion=2、报告 schemaVersion=2，比较 key 包含派生版本，旧曲线保持断开。

代码从既有终态数量计算 Run 失败率 `failed/(failed+succeeded)`，不混入新建任务的当前状态。A2A 失败率同时展示终态覆盖、未结束数量、等待原因与 asOf。工具分别展示成功、失败、拒绝、取消、未执行、未知、在途及错误类；拒绝等不进入成功／失败分母，但不能消失。数值为零与采集缺失分开，零分母不可计算。

比例展示百分比、分子／分母及较上一可比日的百分点变化；次数保持次数。曲线 7/30/90 天按自然日截取，缺日期、未知、口径或范围变化不补零；低比例使用适合观测范围的纵轴并标明刻度。指标定义相同不表示 Runtime/模型总体相同，已有版本分布变化另行解释，不作因果归因。

### 分析完成记录

统计步骤冻结 report.json 与 analysis-input.json，初始状态为统计已完成／等待分析。`eval:daily analysis` 接受本地结构化分析，要求 reportId、inputDigest、model、facts/hypotheses/recommendations。每条分析包含 text、metricPaths、evidenceIds，并至少引用一个输入中存在的指标路径或样本 ID；代码验证闭合字段、身份摘要及引用存在性。

每次提交在 analyses 的独立目录保存原始分析与 record.json；失败也保留。analysis-status.json 是最新尝试的可替换指针，含报告、输入摘要、统计文件摘要、模型声明、输出路径、状态及失败原因。report.json 和统计不被 LLM 更新。HTML 合并展示等待分析／分析完成／分析失败及原始统计。

完成记录只证明提交与引用检查完成，不证明解释正确或模型被独立认证；模型身份注明 submitted_not_independently_verified。不让只有元数据的分析推测目标覆盖或反馈吸收，不以主观分析生成质量曲线。

## 离线报告

每个报告目录生成 report.html，根目录生成 index.html，JSON 与原始证据保持权威。Gate 使用质量对照、协作状态分布和逐 Case 变化；每周使用同口径首次尝试趋势；每日使用健康比例与使用量两组曲线。

页面仅使用内嵌样式、受 CSP hash 限定的固定交互脚本与 SVG，无 CDN、服务或网络请求。所有数据文本转义；不执行 Markdown HTML 或任务产物脚本。证据只允许报告目录内的相对惰性文件链接，拒绝 scheme、上级目录、编码分隔符与可执行文件。旧报告缺少新评分时明确显示历史口径。

现有 Rovai HTML 预览的无 same-origin sandbox iframe 可显示自包含报告；报告相对证据导航若受预览拦截，使用系统浏览器打开本地文件。不修改 App sandbox 或资源授权。
