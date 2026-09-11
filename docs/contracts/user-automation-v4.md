---
document_type: interface-contract
contract: user-automation
version: 4
authority: desktop-user-automation-and-evaluation-host
status: accepted
source_version: v1.58
last_updated: 2026-09-10
---

# User Automation v4

完整继承 [v3](user-automation-v3.md) 的用户身份、Trace 导出与日报配置。新增以下封闭评测操作；运输 `contractVersion: 1`、Data Contract、Agent Built-in 和模型上下文不变。当前宿主执行准入范围为 macOS；其他平台不注册执行器。

## 开发者执行器

`rovai app eval configure --source <absolute-checkout> --node <absolute-binary>` 注册一个显式开发者安装。需要 Rovai 源码、Node >=24、已安装仓库依赖以及现有 Rust/Git 工具链。App 不安装依赖、不升级 Runtime、不把整套开发工具链打包给普通用户。

注册保存 Node binary digest 与评测脚本、共享报告模块、协议 schema 和依赖清单的内容摘要。每次运行重新核对；变化时报受阻，需用户终端重新注册。注册目录是用户信任的开发代码，摘要不构成独立主机沙箱或第三方软件签名。操作不接受任意命令、参数数组、shell、环境覆盖或 Core method。

配置、job 回执及 worker 结果位于受 User Automation OS denial 保护的私有目录，不新增数据库列。未配置时不启动评测进程、不查询 Core、不写入记录；空配置检查最多每分钟一次。

## 手动执行

`eval gate|weekly --plan <absolute-frozen-plan> --output <absolute-directory> --job-id <stable-id>` 映射 `eval.gate|weekly`，参数为 `{plan, output, jobId}`，立即返回 job。调用方在第一次提交前选定 jobId，IPC 结果不确定时用同一 ID 查询或重放，不创建新 ID。`eval status [--job-id <id>]` 查询配置或单次结果，`eval cancel --job-id <id>` 只终止当前 App 拥有的该次 worker。

jobId 重放返回原记录；同一 ID 更换输入拒绝。一次只接纳一个活动评测，不排入无界队列。原 Gate/weekly 负责方案、评分、Case seal、实际产品版本、两个尝试上限和报告权威。worker 完成不表示 Gate 通过：`state` 为 `running|completed|failed|interrupted`，`reportStatus` 独立保留 `passed|degraded|insufficient` 或 null。

## 绑定现有定时任务

`eval schedule --automation-id <existing-id> --plan <absolute-weekly-plan> --output <workspace-subdirectory>` 只绑定现有 Automation，不创建或改变其计划和 Prompt。最多八份配置，输出不能逃出该 Automation 的实际目录，不同绑定不能共用输出。frozen plan 必须为 weekly，预算不超过 2700 秒，为既有一小时 Automation 时限留出分析时间。

Main 通过既有 scheduler tick 观察 Core 已正式接纳的 `AutomationRun`。仅消费注册之后处于 running 的记录，以 runId 作为 jobId，绑定 campId；重复 tick、重复 IPC 和 App 重启不会重跑同一记录。未开启、目录变化、运行取消或过早结束时不继续评测。配置或版本检查失败写终态回执，不让分析 Agent 无限等待。

绑定的 weekly plan 同时是冻结的比较模板。宿主先验证模板的非产品输入，再构建其中指定 repository 的当前源码并冻结本次实际计划；不自动编辑产品代码、题目或标准。job 保留模板 planDigest 与实际 executionPlanDigest，报告引用实际代码、配置和 Case。构建也受 Host 总时限约束，构建过慢不能获得额外无限预算。

分析 Agent 仍不能调用 `rovai app`。绑定时把只读 `wait-for-evaluation.mjs` 放入分析输出目录；Agent 使用当前 Camp ID 等待 `automation/<campId>.json`，最长 55 分钟。它不提交工作、不访问 owner IPC，只输出匹配的完成／失败回执；旧 Camp 报告不能代替本次结果。`completed` 后再读取回执指向的报告及证据，由现有普通 Camp 公共消息收口。

## 关闭与恢复

App 退出、owner 取消或预算耗尽时，worker 终止自己的后代进程，包括分离的 Runtime 子进程。进程识别包含启动时间，不能根据历史 PID 终止无关进程。worker 观察原宿主退出后自行停止；App 重启将遗留 running job 标为 interrupted，不自动重派发、不重写历史评测报告。

本机 App 未运行或设备休眠时仍无常驻执行保证；沿用 [Scheduled Automation v1](scheduled-automation-v1.md) 的 missed/overlap/recovery 规则。宿主执行、Agent 解释、Gate 放行与独立验收是不同证据，不相互替代。
