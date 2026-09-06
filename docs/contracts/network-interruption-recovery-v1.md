---
document_type: protocol-contract
contract: network-interruption-recovery-v1
authority: live-network-interruption-classification-scheduling-and-safe-resume
status: accepted
version: 1
source_version: v1.53
last_updated: 2026-09-06
---

# Network Interruption Recovery v1

本合同只覆盖 Desktop App 与同一 Core generation 持续运行期间的网络中断。它复用 AgentRun、CampTurn、
Runtime Input Delivery、Execution Evidence、Canonical Activity、Fleet 与 Camp Read Side；不建立持久重试队列、
第二套 Run 状态或 Evidence replay。App/Core 重启后的自动续跑不在本合同内，继续使用既有
[Accepted Input Recovery v5](accepted-input-recovery-v5.md)与 Startup Recovery 分类。

## 1. 故障准入

自动恢复只接受以下四类强网络证据：

| category | 合格证据示例 |
| --- | --- |
| `connection_failed` | `ECONNREFUSED`、`ENETDOWN`、`ENETUNREACH`、`EHOSTUNREACH` 或封闭连接失败文本 |
| `connection_reset` | `ECONNRESET`、`ECONNABORTED` 或封闭连接重置文本 |
| `dns_temporary_failure` | `EAI_AGAIN`、`ENOTFOUND` 或封闭临时名称解析文本 |
| `network_timeout` | `ETIMEDOUT`、`connect_timeout`、`network_timeout` 或明确连接／网络／DNS timeout 文本 |

Adapter 提供的 bounded structured code 优先于文本。未知 structured code、普通 `error`、`request failed` 和
`retryable: true` 都不是网络证据。鉴权、权限、配额、模型、配置、用户取消、限流、容量／过载和 HTTP 5xx
必须先排除，不能进入本流程；公开 `retryable` 仍只描述失败属性，不授予自动重发权。

当前 Rovai 接管入口只在 ACP Prompt 已产生 failed terminal、其 Runtime Input Delivery 精确为
`not_accepted`、旧 Prompt route 已解绑且公开错误通过上述分类时运行。支持该入口的 Adapter 为
OpenCode、GitHub Copilot CLI、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE CLI、Cursor Agent、Kimi Code 与
Grok Build。Claude Code 已报告 `runtime_api_retrying` 时仍由原生 Runtime 单独拥有重试，Rovai 只观察；
Codex、Pi、Antigravity、ACP Host 无分类退出、任意 accepted／delivery-unknown 输入及未提供强网络证据的阶段
不由本合同自动重发。

## 2. 固定退避与进程内队列

Core generation 内的 `NetworkRecoveryQueue` 每个逻辑 AgentRun 只保存当前 epoch、Adapter、category、source、
attempt、deadline、in-flight 与 connectivity-hint-consumed 标记。正文、Runtime Input、Evidence 和用户消息不复制进
该队列。无登记项时协调器阻塞等待通知，不轮询网络或历史 Run；Core shutdown 清空全部项。

完成第 N 次网络失败后，从该次失败结束时刻计算下一次延迟：

```text
attempt: 1  2  3  4   5   6   7   8...
delay:   1  2  3  5  10  15  30  30... seconds
```

不使用随机抖动或固定周期。零耗时尝试的累计触发点为 `1, 3, 6, 11, 21, 36, 66, 96...` 秒。
新失败 epoch 只在前一尝试结束并再次登记后推进 attempt；同 epoch 重复 terminal 合并，不增加 attempt。

Renderer `online` 与 Electron `powerMonitor.resume` 只调用 `runtime.networkRecovery.wake`。该方法把尚未 in-flight
的 deadline 提前到当前时刻并唤醒同一协调器；它不读取正文、不调用 Adapter、不能直接发送输入。重复信号合并，
in-flight 项不再接纳第二次尝试。同一故障周期至多消费一次 connectivity hint，消费状态随失败后的新 epoch 继承，
因此持续重复 signal 不能逐档跳过 backoff。online、系统恢复或单次连接成功不清零 attempt；只有当前恢复 epoch 的
Runtime Input 被正式接受，或正常终态／取消／失效收口，才结束该故障周期。

## 3. 领域状态与正式准入

合格 ACP terminal 在普通失败结算前调用 system-only `agent_run.network_recovery.wait`：

```text
running(epoch N)
  -> waiting / network_recovery
  -> waiting / runtime_recovery
  -> regular Scheduler claim
  -> running(epoch N+1)
```

`wait`、attempt admission 与 progress completion 都要求 actor 为 `network-recovery-coordinator`，并校验精确 Camp、
Run version 和 execution epoch。`wait` 只接受 source `acp_prompt_terminal` 与公开 code
`runtime_network_interrupted`；计时器不直接更新业务表，而是调用上述领域命令，再由既有 Scheduler/Fleet 正式领取。

每次 attempt admission 都重新检查：Run/Turn 非终态且未取消、执行预算未到期、成员仍 active、当前授权覆盖冻结
能力、Input 仍可安全发送，并且没有 pending Approval、active Action 或未结算 Runtime Delivery。安全 Input 只包括：

- 当前 epoch 尚无 Delivery；
- Delivery 明确 `not_accepted`；
- Delivery 为 `prepared` 且尚未写入 `dispatch_started_at`。

`accepted`、`delivery_unknown` 或已经跨过 dispatch boundary 的输入一律禁止自动重放。检查失败且 Run 仍需人工收口时，
转为 `waiting/network_recovery_blocked`、停止自动 timer，并保留普通 Run Stop；已经取消、到期、终态、被 successor／
版本 fence 取代的项直接撤销。正式 Scheduler claim 再执行现有 version、epoch、lease、conversation、Fleet 并发与
accepted-input 纵深门禁，因此自动恢复和其他执行入口不能并行取得同一 Run。

旧 epoch terminal 迟到时只按同一故障登记合并，不能结束或重置 recovery cycle；只有更高 recovery epoch 的正常终态、
Input accepted，或取消／失效等显式生命周期收口可以清除旧项。

恢复 claim 后，只有当前 epoch 的 Runtime Input Delivery 成为 `accepted`，Core 才清除
`runtime_network_interrupted` 和内存故障周期；单纯重建 Host、Session 或连接不算恢复。之后 Runtime 按正常执行和
terminal 路径运行。若新 epoch 在接受输入前再次以合格网络 terminal 结束，沿用同一逻辑 Run 的下一档 attempt。

## 4. 生命周期、投影与观测

- 网络等待不暂停、不延长 CampTurn Execution Budget；到期和用户取消继续走现有结算。
- planned/unplanned Core shutdown 先停止网络协调器，再完成普通 Scheduler/Runtime 收口；旧回调受 version/epoch/
  route fence 拒绝。
- 如果 Core 在 `waiting/network_recovery` 时消失，启动恢复把该 marker 归一为既有
  `waiting/runtime_recovery`，不恢复内存 attempt 或 deadline，也不创建跨重启自动恢复保证。
- 日志只记录 Run、epoch、source、attempt、delay seconds、category 与 admission/stop code，不记录输入、凭据、
  raw protocol payload 或未脱敏错误。
- Read Side 继续投影同一个 AgentRun。Renderer/渠道共享 presentation：`waiting/network_recovery` 为
  “连接中断，等待恢复”，带网络 failure 的新 `running` epoch 为“正在恢复”，
  `waiting/network_recovery_blocked` 为“需要处理”。只有 Input accepted 后才恢复普通“执行中”；所有非终态路径保留
  用户 Stop，已有输出、草稿、附件、Approval 与 Evidence 不清空。

## 5. 验收边界

确定性测试必须覆盖固定 interval 与累计时刻、长 attempt 从结束时计下一档、重复／提前 wake、in-flight singleflight、
严格网络分类、accepted/unknown/dispatch-started 输入拒绝、每次 admission 重验、progress ACK 才清提示、旧
version/epoch、取消／期限、Core shutdown 清队列与 startup 归一。Adapter 测试还必须证明 ACP
`not_accepted + network terminal` 在终态结算前进入等待，而 accepted 输入、HTTP 5xx、鉴权、限流和原生自重试不被
Rovai 接管。

真实 Runtime 验收必须使用隔离 App data directory、隔离 workspace 和无危险外部效果输入，并分别记录：原生 Runtime
自行恢复的链路，以及 ACP 原生 terminal 后由 Rovai 新 epoch 接管并获得 Input accepted 的链路。缺少后一条实证时，
只能声明实现与自动化回归完成，不能把目标 Runtime/平台组合晋升为已完成真实恢复资格。
