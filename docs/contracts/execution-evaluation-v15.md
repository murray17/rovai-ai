---
document_type: interface-contract
contract: execution-evaluation
version: 15
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.59
last_updated: 2026-10-08
---

# Execution Evaluation v15

继承 [v14](execution-evaluation-v14.md) 的任务、评分、证据、日报与历史保留规则，增加显式无时间上限的 Weekly。

## 冻结时间策略

新无时间上限计划使用以下字段，三处必须一致；零值、缺失值和非法数值不能代替 `null`：

```json
{
  "mode": "weekly",
  "budget": { "wallSeconds": null },
  "execution": { "version": 1, "maxParallelCases": 2, "judgeSeconds": null }
}
```

独立 Judge 配置同时声明 `timeoutMilliseconds: null`。冻结、执行和宿主分别验证策略；有限计划继续使用原有
总时长与每 Case Judge 时限，Gate 不接受无时间上限。旧计划与结果不改写。时间策略属于 campaign 和趋势
比较身份，不把不同时间条件下的结果连接为可比曲线。

无时间上限覆盖源码构建、合同测试、整轮、Case Runtime、Judge 进程与评分请求；等待器只等待当前 Camp 的
真实终态回执。CLI/RPC 操作、进程观测、停止清理、未决交付与需要人工恢复的失败边界仍有各自操作期限。
每周最多两次尝试、Judge 的有限运输重试、并发度、输出大小及 Case 的 Run/A2A 数量限额保持。

## Case 与 Core 冻结证据

Case 原有 seal 和题目不变。无时间上限的 Regression 配置增加 `timeLimit: null`，Runner 保留 Case 声明预算，
并将有效 `elapsedSeconds: null` 交给 Core；普通 Runner 未提供该字段时继续采用 sealed Case 时限。
结果的 `budget.contract` 仍是 sealed Case，`budget.timeLimit` 与 `budget.frozen` 记录实际执行策略。

提供 Core `execution.budget` 时，`elapsedSeconds` 必须显式存在，可为正整数或 `null`。省略整个预算或显式
`elapsedSeconds: null` 均不限制总时长、不生成截止时间。显式有限时长按请求冻结，不再截断到 24 小时；
正数校验、时长表示范围及截止时间溢出校验保留。有限时间保持 budget schema 1；无时间上限冻结为 schema 2：

```json
{
  "schemaVersion": 2,
  "acceptedAt": "2026-09-15T00:00:00+00:00",
  "deadlineAt": null,
  "elapsedSeconds": null,
  "maxAgentRunResponsibilities": 8,
  "maxAcceptedA2a": 4,
  "rootAgentRunResponsibilities": 1
}
```

Core 的 CampTurn 读取模型沿用该时间字段，并继续投影已分配 Run、A2A 计数和耗尽状态。NULL 截止时间必须由
schema 2 标识；旧 schema 的缺失截止时间不能获得执行准入。派发、协作、重试和恢复共同消费这一事实。
手动停止、权限检查、数量预算与 App/Core 重启收口保持有效；没有时间截止不代表运行已经成功。

上述默认值只适用于新冻结的执行；历史记录、已冻结预算和历史 migration 的 24 小时取值均不改写。
普通 Single Chat 的直接发送和 Pending 发布共用此冻结入口；普通 batch Delivery 不创建 CampTurn 时间预算。
已有预算等待任务继续处理显式或历史有限 deadline；没有有效 deadline 时只等状态通知，不安排时间唤醒。
Automation 自身超时、评测显式时间策略、Runtime 取消／清理和网络／接口操作期限保持原合同。

这些字段属于执行请求、Core 读取模型及评测证据，不加入 Native Session Bootstrap、Dynamic Context、
Run Facts 或 Agent CLI。上下文 Formatter、Manifest、Profile 与输入证据版本保持不变。

宿主绑定及 Automation 冻结规则见 [User Automation v6](user-automation-v6.md)与
[Scheduled Automation v2](scheduled-automation-v2.md)。
