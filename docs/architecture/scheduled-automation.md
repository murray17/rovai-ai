---
document_type: architecture
authority: scheduled-automation-architecture
status: accepted
last_updated: 2026-09-05
---

# Scheduled Automation Architecture

Scheduled Automation 是 Desktop/Core 内的持久计划控制面。它只决定何时领取一份已授权定义、如何建立普通 Camp
执行图，以及怎样从 CampTurn 结算运行；具体模型执行、公共消息、渠道凭据和投递仍分别由现有 Runtime、
Collaboration 与 Channel 组件拥有。

## 组件职责

```text
Desktop Automation Workspace ── typed Core RPC ──► AutomationService
                                                       │
                                      SQLite definition/run/delivery
                                                       │
Core Automation Scheduler ── claim/settle/recover ─────┤
                                                       ▼
                         Collaboration admission transaction
                         Camp → Message → CampTurn → root AgentRun
                                                       │ commit
                                                       ▼
                                            existing Runtime Scheduler
                                                       │
                                  public result / terminal CampTurn
                                                       ▼
                  Automation settlement → NotificationDelivery → Channel Host
```

- **Renderer** 只编辑和读取定义、请求立即运行、打开返回的 Camp，不计算权威时间或运行状态。
- **AutomationService** 拥有字段规范化、版本、schedule 计算、occurrence 领取、执行快照、并发门禁、结算和恢复。
- **CollaborationService** 在调用方事务内建立一个普通单队员 Camp 执行图，返回稳定关联；它不自行提交或启动 Runtime。
- **Runtime Scheduler** 只看到事务提交后的普通 queued AgentRun，继续执行已有 preflight、lease、Native Session 和 fence。
- **Channel Hosts** 把 Automation NotificationDelivery 合并进各 provider 的既有按需 claim/settle 循环。

## 数据与控制流

Automation 定义是未来 occurrence 的可变配置。AutomationRun 是一次领取后不可变的业务证据；其 snapshot 不通过外键
依赖仍可删除的定义。CampTurn 保存唯一 `automation_run_id`，AutomationRun 保存 Camp、Turn 与 root Run 三个链接，
数据库触发器拒绝半链接、改绑和终态回写。

计划扫描只处理 `enabled` 且到期的少量定义，并在 immediate transaction 中重新读取。`nextRunAt` 的推进与 occurrence
行写入处于同一事务，因此重复扫描不会重复消费。活跃运行使用 partial unique index 保护；业务预检查只用于返回清晰的
`skipped(overlap)`。

执行 Camp 使用 Automation 名称作为初始标题、冻结 ProjectRef 解析出的 workspace、所选队员作为唯一 CampMember 与
Default Lead。首条用户消息就是冻结 Prompt；没有 Renderer Composer Draft、Pending Camp 或后续复用会话。

## 恢复与结算

启动恢复先于普通 Runtime recovery：没有终态的 AutomationRun 不会重新派发。若其 CampTurn 仍活跃，Core 使用
`automationRunId + campTurnId` 的精确内部取消事务写入现有 execution fence；然后才让 AutomationRun 终态化并释放
partial unique gate。物理 Runtime 退出继续由既有进程管理收口。

周期 settlement 读取结构化 AgentRun/Approval/CampTurn 状态，不解析模型文本。CampTurn 完成时只在 root AgentRun 的
正式公开消息中冻结一个结果 ID。后续删除、编辑或同 Camp 交流不能替换该 ID，也不能复活终态 AutomationRun。

通知是从 AutomationRun 终态派生的独立 outbox。投递 payload 在结算时冻结，实际 claim 时解析当前 Bot/Owner 绑定；
重试只更新 NotificationDelivery。Provider 没有当前目标时投递明确失败，运行事实保持不变。

## 进程与权限边界

V1 没有常驻独立 daemon、云端 scheduler 或 OS 登录唤醒任务。Core 生命周期和设备唤醒状态决定能否到点执行，恢复只
记录一次 missed。已启用定义是调度执行授权；定义管理继续属于当前本机用户，Agent 只能经 current Built-in lease 和
用户明确意图使用封闭操作。

Automation 来源不改变 AgentRun 的文件、网络、Built-in、External MCP 或 Runtime 权限。执行仍能产生普通外部效果，
因此系统通过禁止恢复重派发来避免把未知中断变成重复执行。

## References

- [Scheduled Automation v1](../contracts/scheduled-automation-v1.md)
- [Built-in Tool Runtime](builtin-tool-runtime.md)
- [Collaboration admission invariants](foundational-invariants.md#collaboration-admission)
- [Runtime recovery and shutdown](foundational-invariants.md#runtime-recovery-shutdown)
- [V1.50-D01](../versions/v1.50/decisions.md#v1-50-d01)
