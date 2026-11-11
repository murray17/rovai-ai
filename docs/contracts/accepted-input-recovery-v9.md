---
document_type: protocol-contract
contract: accepted-input-recovery-v9
authority: accepted-runtime-input-failure-and-execution-isolation
status: accepted
version: 9
source_version: v1.72
last_updated: 2026-11-10
---

# Accepted Input Recovery v9

继承 [v8](accepted-input-recovery-v8.md) 的业务终态、输入证据、不重放、继续与隔离门禁。
本版明确普通取消后的常驻 ACP 释放证明；取消不再必然要求销毁已经确认收尾的 Host。
不改变 Bootstrap、Dynamic Context、Manifest 或 Input Delivery Evidence 的字节、选择及版本。

## 有界原生收尾

普通用户 Run Stop／ThreadTurn Stop 沿既有业务取消事务先结算，再请求 Adapter 清理。
Core 使用同一起点的绝对期限：interrupt 2 秒、ingress flush 2.5 秒、总等待非 Windows 3 秒／Windows 5 秒。
提前完成即继续，不固定睡满窗口，不在 Adapter 内重新开始阶段时钟。

共享 ACP 在发送原生取消、封住该 Run 的客户端终端创建并处理已建终端后，等待精确 Run/epoch、
Session/prompt 的原始及已提交补充请求全部结束。只有已关联的正常或 cancelled 原生终态才支持复用；
单个 RPC 返回、取消通知已写出、本地 token 取消、缺少 handle 或 route 均不足。
有效请求错误、断连、未知结果或超时继续停止与回收。Steer 的取消不能把 accepted/unknown 改成 not_accepted。

确认收尾后排空旧 ingress、解除旧 Run 路由与 CLI lease，再调用既有 Fleet release。
健康、静止、租约匹配且没有退役原因的 Host 才进入 IdleWarm。终端、未决 RPC、子任务或退役状态不满足时，
沿原停止路径处理。阶段失败在慢 flush 前即收窄复用；进入 Stopping 后迟到终态不能恢复 Warm。
释放成功的清理分支立即返回，不再继续通用 stop。
已业务取消的 Run 不再由普通原生终态回调提前 detach/release；回调保留结果供原 cleanup 确认，
避免它与有界取消等待竞争而误判路由丢失。计划关闭的专用终态分类不改。

## Release 与 ACK 的事实

| 共享释放结果 | 可确认的事实 |
| --- | --- |
| `Reusable` | 该 Run 的原生请求、事件与授权占用已收尾；释放时 Host 存活且通过复用检查 |
| `Reaped` | 对应受管进程已确认完成回收 |
| `NoMatchingLease`／`ReapUnconfirmed` | 单凭该结果不能写 cleanup ACK；已有精确“启动结束且没有建立路由”证明仍按原规则处理 |

前两者均可解除旧 Run 的清理门禁；只有 Reaped 证明进程退出。Reusable ACK 不删除仍存活 Host 的
owner record、Bootstrap 或临时目录。取消 worker 的 `agent_run.runtime_cleanup_completed` 通知以
`hostDisposition=reusable/reaped` 表达这一区别；业务终态与清理 ACK 仍是不同事实。

Fleet 原有清理回执按 Run/epoch 保留实际 release outcome，直到 Core 成功写入 durable ACK。
重试不得把 receipt 缺失推成成功，也不得用旧 cleanup 停止已经领取同 Host 的 successor。
Reusable 回执是释放时的隔离证明，不是对 Host 此后持续存活的承诺；Host 后续回收不撤销旧 Run 已隔离的事实。
新 Run 使用自己的 Run/epoch、CLI lease 和冻结 Bootstrap，旧批准、回调、输出与终态不能获得新身份。

## 适用范围

此变化只衔接常驻 ACP 的既有释放检查。应用退出、安装禁用、成员移除、配置不兼容、显式退役等仍停止 Host；
退出报告仍须单独确认受管进程回收，不能用 Reusable ACK 代替全局 shutdown。
ZCode 的专用 cancel fence 与后台所有权保持；Hermes 的 Gateway 不属于 Core 所有，ACP 客户端回收
不证明共享 Gateway 或其原生执行已停止。Claude one-shot、Codex 和 Pi 的生命周期保持。

没有新增取消状态机、队列、清理管理器或持久状态字段。Kilo 具体配置见
[Runtime Launch v84](runtime-launch-and-verification-v84.md)，理由见
[V1.72-D82](../versions/v1.72/decisions.md#v1-72-d82)。
