---
document_type: interface-contract
contract: execution-evaluation
version: 1
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.57
last_updated: 2026-09-10
---

# Execution Evaluation v1

## 两条证据链

真实任务回归在全新 Core data、Skill Library、MCP config 和 workspace 中执行固定任务并检查产物；每日运行分析只读取保留的执行元数据及其覆盖声明，不重放原任务。两条链路的输出都不等同于用户任务成功或能力提升。

## Gate 与每周回归

上下文／共享机制或核心 Skill（初始显式名单为 `cli-operations`）使用 10–15 个不同 Case；首批通用集为 12 个。其他 Skill 取其专属集的并集；共享机制影响升级通用集。没有相应专属集时拒绝冻结，而非空集通过。具体任务见[回归目录](../../qualification/context-regression/README.md)。

`build` 通过真实 Cargo build 绑定源码 commit、生产源码内容摘要、Core/CLI 二进制摘要；`freeze` 固定方案文档及 revision、开发者确认依据、前后差异、不变边界、Case seals/fixture、Runtime/模型/权限、预算、重复次数、Judge 配置和评测器摘要。`run` 在执行前核验这些身份。每周模式只评当前版本，无上下文改动确认，仍冻结任务与运行条件。

原始确认由现有 Skill 引导，CLI 只验证记录完整性，不能认证或代替开发者。只有开发者明确授权代理自行选择时才允许 `delegated_by_user`，记录该指令、发出者、时间与 revision；不能把普通首次同意自动解释为委托。

两个产品版本分别运行合同测试，记录真实 target、selector、匹配到的测试名、结果、日志和摘要；编译失败、零匹配、ignored、超时均为证据不足。不得把一个批次的退出码分配为每条标准的通过。

真实任务复用 Qualification Runner 与 Case v2。回归配置是本地评测输入，不能用于 Formal qualification 或 Team/Solo paired experiment。版本间共用任务、模型、权限、预算和初始 fixture；记录实际环境，重复轮次交替基线／候选顺序。环境不同或未知不能自动比较。

每个 campaign 最多两次尝试，每次使用冻结的 `wallSeconds` 预算与 1–3 次重复；预算不足的 slot 明确保留 `not_run`。修复实现后可以重建候选并用同一标准重试；基线、评分、Case、模型、预算或方案语义改变必须形成新的已确认方案，不能删除失败目录重置次数。

规则验收产物、测试、写入范围、A2A 接纳与预算、只读任务的前后记忆／候选状态；可观测工具证据不足时不假定未调用。正向最低次数可由已观察证据满足；证明“不调用”需要完整覆盖或权威状态验证。

当前 A2A 的预算接纳只计 `public_a2a` 且 `dispatchDisposition=dispatch`；Gather 捕获回复和完成投递不新增调用，但收口仍检查所有投递。旧 Ledger 的 `slot` 在当前适配中是按接纳事件排序的展示序号，不冒充 Core 配额槽；原始收件人位置保留在执行证据中。人工干预以真实投递前的全局水位为界，不能把已准备的历史消息算作运行中干预。

LLM Judge 复用 [Semantic Judge Views v1](semantic-judge-views-v1.md) 的 Process/Outcome、固定 rubric、反序双副本、Evidence ID 验证与不一致保留。API adapter 禁用模型工具、网络能力和工作区访问，模型只能看到受控 Evidence Pack；Adapter 自身的 API 运输不属于模型工具。fixture adapter 不得成为 Gate 的真实语义证据。缺少凭据、版本不匹配、拒答、截断、非法 JSON 或无依据评价均不足。

`HardOutcome` 继续只由规则产生，Judge 不改写它。外层 Gate 结论是 `passed | degraded | insufficient`：候选硬性失败、关键语义不满足或明确语义退化阻止通过；其余必需证据缺失、副本分歧、失败基线或环境不可比为不足。`newRegression` 单独说明是否有合格基线支持“新退化”，候选失败不自动归因于改动。禁止总分抵消、投票、平均、pass@k、删样本或临时改标准。

同环境的 dispatch-to-terminal 同时增加超过 50% 和 15 秒视为资源退化；真实 wall/Run/A2A 预算继续由 Runner/Core 执行，缺少统一 receipt 的 Token/费用不可用。每周曲线保留第一次尝试及固定样本分母，重跑单列，缺周与环境变化断线。

报告及所有尝试对应实际代码、方案和配置版本。独立保留集与公开回归集分开；第一版独立验收状态为 `not_run`，不能声称已通过保留集。

## 每日规则统计

按配置的 IANA 时区分析前一完整自然日；夏令时的 23/25 小时保持真实边界。显式历史日期也必须已结束。数量和比例分母一并保留：

| 范围 | 口径 |
| --- | --- |
| Run | 窗口内创建数；`endedAt` 落入窗口的成功／失败／取消；当前采集时点仍 queued/running/waiting 的分布 |
| A2A | 窗口内 `public_a2a` 且 `dispatchDisposition=dispatch` 的当前终态分布；失败比例为 failed/(failed+settled)，另存终态覆盖；捕获回复单列，完成投递不计交接；保留窗口内失败与 retry 事件，跨天未结束不算失败 |
| 工具 | 当前 classifier 的可观测操作；分别统计 Core/Runtime 的窗口内终态、错误类、分母、未知、回放排除与 Run 覆盖；不能合并不同来源的计数 |
| 记忆 | 第一版 `bodyReads`、`formalRevisions` 为 null/unavailable，待精确逻辑调用去重与正式修订计数交付后接入 |

统计只覆盖保留记录及显式排除后的总体。现有数据不能可靠还原全部执行来源、每个历史 Run 的 Rovai build、所有 Runtime 工具错误或跨来源操作关联，必须在 coverage 中声明。缺数据不填零。当前 Run/Delivery 状态是 `asOf`，不是历史午夜状态；窗口内终态事件与采集时点状态分别解释。

分析输入另按已有 Run 字段汇总 Runtime 版本、观测模型 ID 与 binding digest 的分布，保留所选 Run 总分母及未知数量，不以当前安装版本回填。历史分布变化由代码标注；指标口径可比较不代表两天的模型总体相同，也不支持因果归因。

报告保存 scope、window、版本、数量、分母、源事实摘要和采集水位。同日成功报告冻结；失败尝试仍按独立目录保留，重试成功后只更新趋势选择指针，不删除失败文件。趋势最多展示 90 个日期，按时区、范围、口径、exporter 与 coverage 分组；未知、缺日期、不可比时断线。原始成功报告保留，不自动删除。

实现期间对照真实 Gather 证据校正了交接分母，当前 `metrics.definitionVersion=2`；先前 definition 1 的验收文件保留，不与新口径连线。

代码生成 SVG、JSON 曲线与数值变化，LLM 只解释昨天指标、可比历史、版本、缺口和少量已定位样本。采样不是总体，语义分析不进入第一版数值曲线。分析 Agent 通过既有 Automation 运行、输出 Camp 结果及可选 `analysis.md`；统计程序自身从不声称已调用 LLM。发现问题可人工关联新回归 Case，不自动重跑用户任务或修复实现。
