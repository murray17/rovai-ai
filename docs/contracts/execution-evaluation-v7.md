---
document_type: interface-contract
contract: execution-evaluation
version: 7
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.57
last_updated: 2026-09-10
---

# Execution Evaluation v7

v7 继承 [v6](execution-evaluation-v6.md)，新增 Suite 2.5.0 / scoring 2.3.0 / [Semantic Judge Views v5](semantic-judge-views-v5.md)。原任务集、Case 版本、权重 50/25/25、硬验收、协作适用性、关键项及执行预算不变。

新评分固定每项的证据来源、判定负责人和验证范围，修正 Outcome 对不可见过程的核实要求。质量与 Gate 仍分开，裁决后的未知仍保留分母并阻断必需项完整性。分歧的原值、一次裁决、失败和未知全部保存。

允许在新目录按同一新标准重新评价完整旧执行证据；必须保存原 report/plan 摘要、实际产品与 Case 版本、新 scoring/rubric/evaluator/Judge 摘要、重评时间和每次调用。原始目录不修改，任何修订只发生在副本。重评不是重跑，不能生成新的运行次数、每周可靠性样本或宣称产品改进；缺少必要证据时保留不足，不能补造。

重评生成的规范化 Case、Catalog、Snapshot、Verifier、Environment、Trial artifact ID 绑定完整 envelope 的 schema、producer、binding、来源边界和 payload 摘要。同一语义名称不会覆盖不同评测器版本的产物；逻辑 Case／Catalog 身份仍在 payload 中。历史 artifact 与引用不改写，所有新引用指向本次实际保留的 artifact。

指标可验证性不等于每次都获得确定判定。报告要区分没有执行、证据采集缺失、超限、评价分歧及已观察到的实际失败。未覆盖的主机全局网络／文件行为、不可权威采集的 Token／成本、单次样本无法证明的可靠性均保留限制，不伪造完整测量。

本次只改变显式评测配置、Judge 与报告数据；不修改产品模型上下文、内置 Skill、普通用户持久化、CLI 帮助注入或每日 Trace 口径。
