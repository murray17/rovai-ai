---
document_type: contract
name: Runtime Launch and Verification
version: v95
status: accepted
source_version: v1.72
last_updated: 2026-11-15
---

# Runtime Launch and Verification v95

继承 [v94](runtime-launch-and-verification-v94.md)，按 User sequence 144 恢复 Goose 的尽力撤回，
撤回成功不再提供旧工具，撤回失败或未确认不单独阻断 Run。

## Goose 撤回范围与机会

每轮沿原入口计算、冻结并传入当前 MCP。仅在精确恢复后、普通任务前调用原生扩展接口；新 Session 和兼容 Warm 不重复扫描。
候选为原生实际列表中 `rovai_assigned_*` 名称减去当前分配。当前分配、用户原生扩展不删，
不因连接状态失败而删除仍分配的项；稳定名称、共享配置兼容判断、Host 替换、Session 与 cwd 入口保持。

## 整批短预算

list 与全部独立 remove 共用一个从撤回开始计算的绝对截止点，当前 Rovai 上限为 500 ms。
这是本地管理操作的等待选择，不是 Goose 原生要求，也不调整既有历史回放、取消或清理预算。
独立 remove 沿现有 RPC 并行发出，第一项不回包不挡住其他项；不重试，不增加并发池、后台任务服务或存储。

共享 RPC 可接受绝对截止点，写入等待与响应等待共用该期限。正常响应、错误、超时均移除对应本地 pending。
仅等待 writer 时超时不损坏连接；已经开始但未完成的帧或实际 I/O 故障沿现有连接故障处理。

| 结果 | 后续 |
| --- | --- |
| 列表正常、无过期项 | 立即继续，不发送 remove |
| remove 成功 | 记录原生成功，不重新 list 核对 |
| 单项明确失败 | 记录诊断，其他项继续获得处理机会 |
| list 不可用、错误或缺少列表 | 记录诊断，跳过本次撤回，不猜测对象 |
| 截止点已到 | 停止等待，记录未确认；连接可用则继续 |
| 进程退出或通信损坏 | 如实走既有故障路径，不能伪造业务启动 |

撤回错误本身不得触发杀 Host、新 Session、历史清空、业务重放或后台重试。
后续正常恢复／配置变更时可再次根据原生列表尝试，不新增永久 dirty、重试队列或扫描器。

## 迟到操作与原生边界

本地超时不取消已经交给 Goose 的删除；迟到响应被丢弃也不代表原生动作停止。
重新分配使用现有配置兼容性路径：旧 Host 确认回收后，新 Host 才精确恢复并应用当前分配。
必须验证超时后重分配同一项的实际原生结果，不能用本地 waiter 已删除代替。

session/load 自身的原生扩展激活属于独立边界。软性撤回不证明旧 MCP 失联时 load 能完成，
不把 remove 提前到 load 前冒充解决，也不在 Rovai 复制原生数据库、探测器或重启系统。
Goose stdio 初始化等待的独立研究／局部补丁与正式 Rovai 撤回验收分别记录。

## 验证

沿既有 live-model owner 验正常、空列表、list 不可用、不回包、单项错误、多个不回包、writer 等待与真实断连。
核对同 Session 的普通任务、所有独立候选获得机会、本地 pending 清空和一批只用一个预算。
官方 Core 验正常撤回且保留当前／用户原生 MCP，以及原生已收 remove、客户端超时后重分配同一项。
原生 probe 单独报告失联 MCP 的冷恢复，官方二进制与局部补丁不得混记。Preview 和平台资格不提升。
