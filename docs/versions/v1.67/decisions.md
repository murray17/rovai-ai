---
document_type: version-decisions
version: v1.67
authority: decision-rationale
lifecycle: historical
last_updated: 2026-09-23
---

# v1.67 版本决定

<a id="v1-67-d01"></a>
## V1.67-D01：Task 字段补丁与模型输入技术字段清理

- 状态：accepted
- 日期：2026-09-23
- 当前权威：[Durable Task v5](../../contracts/durable-task-v5.md)与[ContextManifest v28](../../contracts/context-manifest-evidence-v28.md)

### 背景

Task `expectedVersion` 要求调用者先读版本再提交，导致不同字段的独立修改互相阻断。Agent Task
结果中的 `availableActions` 只是提示，不能授权。模型输入中的 `schemaVersion` 由 Core 解释和选择，
没有交给模型作业务判断的用途。

### 选择

删除 Task 对象版本、关联执行版本快照和所有更新前置版本字段。每次更新以当前事务内读取的 Task 为
基础，只应用提交字段；同字段以后成功提交覆盖先前值。保留权限、状态机、终态、原子事务和命令幂等。
Agent 四类 Task 输出省略 `availableActions`，Core 继续实时授权，UI 可保留自己的操作提示。

Bootstrap 与动态模型投影在生成时省略技术 `schemaVersion`，新证据按实际投影重算 digest。内部协议
版本继续用于写入和恢复准入。旧冻结执行不以新 Formatter 转换或自动重放；历史审计保持原字节。

### 后果

- 不同字段可以独立更新；同字段由后一个成功事务决定最终值，调用者需根据当前状态判断业务意图。
- Agent 输出更小；若需要授权判断，必须由 Core 实际调用结果决定。
- 新 Session/Run 使用新字节与版本轴；旧冻结输入不再可派发，必要时开始新 Session。

### 未选择方案

- 隐藏或自动填写 `expectedVersion`：仍保留了用户明确取消的更新门槛。
- 把 `schemaVersion` 改名后继续投给模型：增加重复的技术内容而没有业务用途。
- 转换旧冻结输入：无法保持历史冻结证据的原字节与 digest。
