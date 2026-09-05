---
document_type: version-decisions
version: v1.50
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-05
---

# v1.50 版本决定

<a id="v1-50-d01"></a>

## V1.50-D01：领取后不可恢复派发，派发图在同一事务内完整建立

### 背景

定时触发必须避免进程在“已记录触发、尚未或正在创建对话”的窗口退出后重复执行 Prompt。只用确定性 command ID
在重启后重试可以实现最终派发，却会让用户无法判断退出前 Runtime 是否已经开始产生外部效果。

### 决定

Core 在领取 occurrence 的同一事务中冻结 AutomationRun，并原子创建和关联 Camp、首条消息、CampTurn 与 root
AgentRun；提交以后才允许 Runtime 领取。重启只按现有 CampTurn 权威状态结算，从不重新派发。仍在执行的精确
CampTurn 先由 Automation 内部取消入口进入终态，再把运行结算为 `failed(interrupted)`。

### 后果

一次运行最多创建一个新 Camp，定义编辑不能改变已领取输入，恢复路径也不会重复 Prompt。代价是进程退出时一个尚未
完成的运行会明确失败，即使它理论上可以重试；用户要再次执行必须创建一个新的手动 occurrence。

### 被拒绝方案

- 只持久化 occurrence 和确定性 command ID，重启后继续派发：无法排除退出前 Runtime 已产生不可见外部效果。
- 先创建 CampTurn、后写 AutomationRun 关联：留下无法安全识别或取消的半派发图。

<a id="v1-50-d02"></a>

## V1.50-D02：AutomationRun 与渠道通知使用独立生命周期

### 背景

队员执行和渠道 Bot 投递由不同系统负责，失败原因、重试条件和用户补救方式不同。把通知放进执行事务会让暂时的渠道
故障把已经完成的工作错误地标成失败，或通过重试重新执行具有外部效果的 Prompt。

### 决定

AutomationRun 只由 CampTurn 及冻结结果消息结算；每个所选渠道建立独立 NotificationDelivery，发送前重新解析当前
Bot/Owner 绑定，最多尝试三次。投递失败不会改变 AutomationRun 终态，也不会重新执行任务。

### 后果

界面可以诚实显示“运行成功 · 通知失败”，渠道恢复只处理待投递消息。删除 Automation 定义仍保留既有 Camp 和不可变
运行历史，确保执行证据不会随管理操作消失。

### 被拒绝方案

- 通知失败把 AutomationRun 改为 failed：混淆执行事实与送达事实。
- 通知失败重新运行 Prompt：可能重复文件、网络或外部系统副作用。
