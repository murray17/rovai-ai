---
document_type: interface-contract
contract: execution-evaluation
version: 6
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.58
last_updated: 2026-09-10
---

# Execution Evaluation v6

v6 继承 [v5](execution-evaluation-v5.md) 的报告、隔离、预算、历史和未知处理，新增 Suite 2.4.0 / scoring 2.2.0 / [Semantic Judge Views v4](semantic-judge-views-v4.md)。50/25/25 权重、逐 Case 汇总、硬门槛及协作分项统计不变。完整总分仍以所有必需评分项得到有效判定为前提。

DEMO-106 1.2.0 将既有“审查并修复”任务明确为连续的审查、Lead 修复两个阶段；函数、输入、硬验收、允许范围、参考实现和预算均不变。旧 1.1.0 Case 与报告保留，不直接混为相同任务比较。

新回执、Task 正文和交付集合只保存在显式隔离评测产物中。每日 Trace 数据口径、CLI 产品帮助和日常持久化行为不变。新报告必须绑定新评分、Case、源码、Runner、Judge 和配置摘要；旧报告保持原标准，跨口径曲线断开。真实执行、Judge 不可用、Agent 失败、环境受阻仍分开记录，不用测试夹具代替真实结果。
