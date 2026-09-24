---
document_type: version-decisions
version: v1.68
authority: decision-rationale
lifecycle: current
last_updated: 2026-09-23
---

# v1.68 版本决定

<a id="v1-68-d01"></a>
## V1.68-D01：公开历史由自动投递改为按需读取

- 状态：accepted
- 日期：2026-09-23
- 当前权威：[Run Facts v7](../../contracts/run-facts-v7.md)、[ContextManifest v29](../../contracts/context-manifest-evidence-v29.md)、[Profile 9](../../contracts/context-delivery-profile-v9.md)与[Camp History v9](../../contracts/camp-history-v9.md)

### 背景

原公开 Camp Context 自动选择最近消息、引用闭合及遗漏提示，与本轮完整 `RUN_INPUT` 一起占用预算。Agent 已有按权限与实时可见性读取公屏的 `camp.read`；近期窗口无法确定某项任务真正需要哪些历史。原 20 条上限使长间隔倒翻成本偏高。

### 选择

新公开 Run 不自动投递公屏历史，改在 Run Facts 冻结上一次有效 accepted ACK 对应的执行前公屏边界。该边界只是定位参考，不代表已读或完成；Agent 按任务需要用 `camp.read` 从最新页倒翻。默认一页 20 条，显式上限 100 条，超过时必须返回真实续读位置。`RUN_INPUT` 保持完整。Schema 172 只扩展新格式写入约束并保留旧记录；旧格式执行不续派、恢复或重播，同一新格式 Run 仍复用冻结输入。

### 后果

- 新 Run 的模型输入与历史增长解耦；需要早期信息的 Agent 会产生多次读取成本。
- 接受水位说明过去有效执行的起点，不承诺消息被阅读或任务被完成。
- 旧历史审计仍可查，但旧冻结执行需以新执行或新 Session 继续工作。

### 未选择方案

- 强制补读从边界到当前的全部消息：重建自动历史预算，并把无关信息重新放入模型。
- 用边界直接作为向前读取游标：当前按 `before` 倒翻的读取合同不支持，且用户明确接受逐页阅读。
- 为旧冻结格式新增双读或恢复适配：超出本版确认范围。
