---
document_type: version-decisions
version: v1.12
lifecycle: current
last_updated: 2026-08-19
---

# v1.12 决策记录

本文件只解释 v1.12 的重要取舍；当前字段与行为规范由 Architecture、Contracts 和 UI 文档直接拥有。

<a id="v1-12-d01"></a>

## V1.12-D01：双层停止入口与 Run-local 取消权威

### 背景

既有 Composer Stop 以 CampTurn 为边界，原子 fence 整棵执行树；Header 和过程详情因此禁止提供看似相同但
范围不明的 Stop。共享 ExecutionDrawer 已能精确聚焦单个 AgentRun，用户需要在保留兄弟职责继续执行时只
停止该 Run。把这个动作伪装成 Renderer 局部状态会绕过 Core 持久取消、Runtime coordinator 与写入 fence。

### 决定

保留 Composer 作为唯一 CampTurn Stop，在共享 ExecutionDrawer 顶栏增加唯一 AgentRun Stop。新增 User-only
`agentRuns.cancel`，只持久化目标 Run 的取消请求并复用既有 cancellation coordinator。Run-local cancellation
不写 Turn cancel request、不改变 Turn status、不取消兄弟 Run/Delivery，也不创建公共时间线消息。

取消请求提交即关闭该 Run 的新领域写入；Runtime 退出和取消确认仍是第二阶段。Renderer 投影独立
`cancelRequestedAt / cancelReasonCode / cancelAcknowledgedAt`，本地状态只覆盖请求延迟与结果不确定，不能
替代 Snapshot。Recovery Blocker 继续使用“结束此运行”的 outcome-unknown 收口，不与普通取消合并。

### 后果

- 用户可以在不停止整轮的情况下撤销一个尚未终态的职责；
- required Run 最终取消后由既有聚合得到 `failed / required_run_incomplete`，optional Run 不单独阻止完成；
- Core/Read Model/Desktop/UI 必须作为同一纵向合同升级，不能只增加按钮；
- Run 身份授权 seam 必须在取消请求提交后 fail closed；
- 两级入口都显示“停止”，但由稳定位置、确认范围和后果文案消除歧义。

### 被拒绝方案

- 在 Camp Header、Task 卡或时间线复制 Run Stop：会制造多个 selection 与取消范围真源；
- 复用 `campTurns.cancel` 或写 Turn cancel request：会错误取消兄弟职责并改变 Turn 语义；
- 新建 Run cancellation executor：会与现有 coordinator 竞争 Runtime ownership；
- 把 Recovery Blocker 当普通取消：会抹去 accepted-input outcome unknown；
- 只用本地 optimistic status：断连和版本竞态下会把不确定结果宣称为成功或失败。

### 当前权威影响

- [协作与取消基础不变量](../../architecture/foundational-invariants.md#collaboration-admission)
- [AgentRun Recovery](../../architecture/agent-run-recovery.md)
- [Run Process Detail Surface v10](../../contracts/run-process-detail-surface-v10.md)
- [Camp Open Projection v2](../../contracts/camp-open-projection-v2.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
