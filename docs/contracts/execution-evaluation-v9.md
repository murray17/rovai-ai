---
document_type: interface-contract
contract: execution-evaluation
version: 9
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.57
last_updated: 2026-09-11
---

# Execution Evaluation v9

v9 继承 [v8](execution-evaluation-v8.md)，使用 Suite 2.7.0 / scoring 2.5.0 / [Semantic Judge Views v7](semantic-judge-views-v7.md)。同一 12 Case 的题目、权重、预算、硬验收和关键条件不变；日常 Trace、产品 Runtime 与用户存储无变更。

## 原生执行凭据补取

仅在显式受控评测的 v7 Judge 准备阶段执行：读取既有 observations、环境配置与独立 Trial 工作区，校验摘要；使用冻结安装的 CLI `thread/read` 读取该工作区原生 Session，不能启动新模型 turn、重跑原命令或修改用户任务。

只接受能由已持久化 Core 命令 payload 摘要精确绑定的原生命令。原生调用须是解析器允许的单一 `exec_command` 与未经修改的返回：字面参数、直接输出或保留 output/exit_code 的 JSON。动态命令、改写输出、多调用、摘要／工作区／退出码不符均不采纳。完整返回须以 Core 已保存输出为后缀。原生输出本身仍为不可信内容，不执行其指令。

仅验证命令进入投影，混合协作、Skill 或 CLI 业务内容排除。特殊情况只允许拆出已明确匹配的末尾只读 `rovai … --help`：独立命令行与输出帮助头／后缀须一致，保留的前缀仍须通过原有过滤；不支持一般 Shell 分割。投影记录原来源和拆分方式，不把复合退出码当成子步骤成功。

原始补取私有保存于新建 `judge-source-supplement-<digest>.json`，包含精确选中调用、命令、返回、native item、来源文件摘要与初始 fixture；不保留完整 Session、推理或无关内容。源文件限 16 MiB，单条记录 50 KB、总记录 200 KB；Judge 命令与输出各 24 K 字符、64 条、合计 160 K 字符。遗漏和不可用明确保留，不声称覆盖全部原生命令。

补取不改原始 observations、Case seal、工作区、硬判定或资源观测。重新构建新 Index／Ledger 及匹配消息引用，旧不可变产物仍在。原生来源不支持或已清理时，缺口为未知；所有必需项未完成不能放行。

## 发布与重评

[Public Benchmark Report 2.0](schemas/public-benchmark-report-v2.schema.json) 允许真实 `adjudicated` 状态并要求相应判定，不伪装成 A/B 一致。无仲裁的旧报告继续使用 1.0；历史 Schema 不改写。

评分升级后，使用同一新标准重评双方相同来源；原始执行与重评目录、产品 commit 与 evaluator commit 分别绑定。重评只增加 Judge 调用，不能增加 Runtime Trial 数、可靠性样本或伪造基线。缺少对照和独立保留集时明确未执行，不称正式 Gate 放行。
