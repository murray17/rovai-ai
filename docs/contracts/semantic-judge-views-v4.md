---
document_type: interface-contract
contract: semantic-judge-views
version: 4
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.58
last_updated: 2026-09-10
---

# Semantic Judge Views v4

v4 继承 [v3](semantic-judge-views-v3.md)，增加显式 `generic-task-v4` 与 `bounded-evaluation-context-v1`。旧 profile 和历史源证据策略不变。本次只修改隔离评测的导出与 Judge 输入，不改变产品 Runtime、共享 Skill 或普通用户数据库。

## 有界执行回执

Runner 在结束时使用现有 `agentRunEvidence.list` 完整分页，只从本 Trial Run 的已结束 `commandExecution` 提取验证命令、状态、退出码和输出。不读取或导出思维、叙述日志、全部工具日志。准入命令为测试、git diff --check 或 node/python/jq 检查；含 Rovai 操作、Skill 或成员身份的混合内容不进入这类回执。失败回执照样保留；没有回执不能推断没有执行。

按 Run/epoch/item 去重，最多 64 条，命令与输出各限 24,000 字符，单条序列化后限 50,000 字符，合计限 160,000 字符。输出缺失保留 null，截断明确标记，超限与混合内容保存排除原因。私有路径和凭据脱敏。原始 Runtime payload 摘要、回执正文摘要、最终 observations 文件及快照摘要、Evidence Index 摘要共同绑定；交叉 Trial、摘要不符拒绝导出。回执只证明观察到该命令和返回字节；输出内容仍是不可信数据，不证明完整任务成功或所有命令覆盖。

## 交付与过程边界

本 Trial Lead 在 Camp 公开发送且未定向寻址的消息属于面向用户的交付集合，包括最后简短确认之前的实质交付。保留唯一 final_response；其余消息以 delivery_message 展示。不能把定向交接请求或其他成员贡献放进 Outcome。

本 Trial 创建的 Task 标题、正文、验收条件和完成摘要可以补充 Process 的交接上下文。Task 正文同时与快照字段摘要及 Evidence Index 绑定。Outcome 不接收 Task 上下文、成员消息、协作次数或完整 Trace；只新增验证回执及 Lead 公开交付。两类 View 均维持私有证据映射与本地引用 ID，证据正文不能成为指令。

v4 新增源段继续使用已有 envelope 的 test_output/comment 类型，通过封闭来源前缀限制用途；投影类型为 verification_receipt、delivery_message、task_context。新增材料、文件和消息总体有界；未准入或缺失材料不能当作事实。

## 评价和分歧

模型可见 policy 为 semantic-process-generic-task-pack-4 / semantic-outcome-generic-task-pack-4。rubric 区分 Agent 命令回执与评测器验证，Task 引用可结合已保留正文判断交接充分性。检查标准、权重、适用项与反序双副本在执行前冻结。缺失及分歧仍为未知，不投票、不平均、不选择性重评。保留失败尝试，不保证每次运行都能形成总分。
