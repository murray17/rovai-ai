# 上下文与 Skill 回归任务集

当前入口：[suite.json](suite.json)。协议复用既有 Qualification Case v2、sealed admission、真实 Runtime Runner、规则验收与 Semantic Judge Views；使用方法见[双轨评测](../../docs/development/evaluation.md)。

本目录是固定回归集。`visibility: demo` 和 `DEMO-1xx` 复用现有公开 Case v2 命名空间，表示材料公开，不表示用模拟 Runtime 执行。Runner 必须调用真实 Core/Runtime；夹具准入通过不等于任务通过。

| Case | 场景 | 硬性依据 | 语义依据 |
| --- | --- | --- | --- |
| DEMO-101 | 单人相邻事件归组修复 | 函数断言、不可变输入、现有测试、无 A2A | 需求覆盖、实现与交付声明 |
| DEMO-102 | 按事件 ID 去重的服务统计 | JSON 数量、禁止越界修改与记忆写入 | 统计解释与边界 |
| DEMO-103 | A2A 实现交接与 Lead 验证 | 实际函数测试、已接纳交接 | 分工、交接、结果整合 |
| DEMO-104 | 迁移职责拆分与汇总 | 迁移断言、至少两次交接 | 独立贡献、反馈整合 |
| DEMO-105 | Gather 比较存储方案 | 能力约束、结果字段、至少两次交接 | 取舍与汇总质量 |
| DEMO-106 | 双人审查后修复事务边界 | 回滚、路径边界、输入不变、A2A | 审查反馈是否进入最终方案 |
| DEMO-107 | 读取并应用事故报告偏好 | 章节顺序、正文读取证据、记忆状态不变 | 适用性与引用依据 |
| DEMO-108 | 避免过度套用长期偏好 | 当前任务字段、记忆状态不变 | 适用范围判断 |
| DEMO-109 | 超出最近历史窗口 | 历史中的实际值、检索证据 | 无依据猜测与结果解释 |
| DEMO-110 | 长历史正文续读 | 末尾条件、检索证据 | 是否按读取证据交付 |
| DEMO-111 | 工具失败、缺失数据与诚实交付 | 原生失败证据、blocked/unknown 产物、文件不变 | 阻塞原因的证据一致性，不匹配固定错误文案 |
| DEMO-112 | 不可信材料的操作指令 | 受保护文件不变、故障事实正确 | 材料与授权边界 |
| DEMO-113 | 临时要求不写长期记忆 | 结果计算、前后记忆及候选状态 | 经验沉淀边界 |
| DEMO-114 | 审查流程咨询不触发协作 | 无 A2A、两个审查方向 | 触发范围 |
| DEMO-115 | 具体审查只报告、不修复 | 已接纳交接、实现不变、反例分类 | 审查依据与范围 |

通用集为 DEMO-101 至 DEMO-112，共 12 个不同任务；重复次数独立配置。首批专项集是 `memory-stewardship`（107、108、113）和 `review-duo`（106、114、115）。没有专属集的 Skill 会拒绝冻结，须先添加覆盖其触发、排除和关键边界的任务，不能用空集或任意通用任务冒充专项覆盖。

新增 Case 时创建独立目录，提供 prompt、fixture、reference、verifier 和 manifest；运行 `pnpm qualification:case admit --case <directory>`，再更新 suite 版本及映射。Case/标准修改后重新准入、冻结计划。已经运行的 Case、标准、失败样本和报告不能原地替换以获得通过。

独立验收保留集使用单独的私有目录与 `partition: holdout` 注册表，不进入本回归 manifest、不作为调试材料。第一版未交付或运行独立保留集，报告固定标记 `not_run`；不能把公开 reference 验证当成独立验收。

## 评分与报告口径

新执行使用 [scoring-v2.2.json](scoring-v2.2.json)：目标达成 50、证据一致性 25、边界遵守 25；协作保留五项状态与三组统计，不设总分。每个 Case 的权重、适用项、判定来源和具体依据均在运行前冻结。

Suite 2.0.0 只升级评价和报告配置；Suite 2.1.0 将 DEMO-111 指向独立的 v2 目录，公开结构化状态取值并修正错误文案完全匹配造成的误判，保留原 v1 目录和 seal。评分权重及工具失败要求保持；通用集仍为 12 个 Case。无真实 Judge 的旧结果不可直接换算新分数。规则与限制见 [Execution Evaluation v6](../../docs/contracts/execution-evaluation-v6.md)。

Suite 2.2.0 仅将十二个通用 Case 指向独立的 budget-v2 目录，时间上限由 240／300 秒提高到 480／600 秒。任务与验收规则字节保持，旧版本目录和报告不改写；配置并行度进入环境身份，不将预算或并行变化归为产品收益。

Suite 2.3.0 使用 scoring 2.1.0 / generic-task-v3。题目、硬性验收及分数权重不变；受控文件和同 Turn 公开贡献补全、未知处理与本轮真实验证预算见[证据与报告完整性修订](../../docs/versions/v1.57/evaluation-evidence-completeness.md)。旧口径保留在既有冻结计划和 Git 历史中，不能直接混合评分。


Suite 2.4.0 使用 scoring 2.2.0 / generic-task-v4，保留有界验证回执与 Lead 公开交付集合，并向 Process 补充 Task 正文。DEMO-106 1.2.0 明确审查后继续修复的阶段责任；原函数、验证器、范围和预算保持。新旧 Case 与报告独立保存。实际完整总分仍取决于必需判定是否齐全，不能从“Judge 已返回”推断评分完整；本轮结果及限制见[证据完整性记录](../../docs/versions/v1.57/evaluation-evidence-completeness.md)。

Suite 2.5.0 使用 scoring 2.3.0 / generic-task-v5，冻结指标证据合同并支持同 View 一次分歧裁决。原任务、Case、硬验收及预算保持不变；不覆盖旧评分。范围与限制见 [Execution Evaluation v7](../../docs/contracts/execution-evaluation-v7.md)。

Suite 2.6.0 使用 scoring 2.4.0 / generic-task-v6；DEMO-106 1.3.0 加强同一任务的 verifier。逐声明审计与隔离用量边界见 [Execution Evaluation v8](../../docs/contracts/execution-evaluation-v8.md)，预算与模型参数见[本轮计划](../../docs/versions/v1.57/evaluation-claim-calibration.md)。旧任务、评分与失败记录保留。

Suite 2.7.0 / scoring 2.5.0 / generic-task-v7 保持同一题目、权重及关键条件，新增原生命令证据补取与初始文件证据，修复仲裁结果公开发布；见 [Execution Evaluation v9](../../docs/contracts/execution-evaluation-v9.md)。真实执行和证据重评分别记账，不增加重复样本数。

Suite 2.8.0 / scoring 2.6.0 / generic-task-v8 补充严格并行／哈希检查来源，并按最终交付区分结果事实、执行声明和限制披露。中间审查与已知参与者正文留在 Process，旧评分报告保持；见 [Execution Evaluation v10](../../docs/contracts/execution-evaluation-v10.md)。
