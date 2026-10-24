---
document_type: interface-contract
contract: user-automation
version: 6
authority: desktop-user-automation-and-evaluation-host
status: accepted
source_version: v1.59
last_updated: 2026-09-15
---

# User Automation v6

继承 [v5](user-automation-v5.md)，扩展显式注册的 Weekly 时间策略，命令与用户 IPC 运输 shape 保持不变。

`rovai app eval schedule` 验证 [Execution Evaluation v15](execution-evaluation-v15.md) 的无时间上限模板后，
通过 [Scheduled Automation v2](scheduled-automation-v2.md) 将对应定义的时间上限设置为 null，绑定返回的
Automation version。普通有限模板保持 2700 秒准入上限及一小时 Automation 时限；重新绑定不能改写活跃 job。

新绑定保存 `timeoutSeconds` 并通过 `eval status` 的 schedules 返回。配置失败不宣称绑定成功；若 Core 配置
已成功而文件写入失败，保留明确错误并允许用户重新执行绑定，不伪造 job、报告或回执。

无时间上限 job 不创建宿主 elapsed timer；每轮从当前显式注册源码构建并冻结新的真实产品。模板、执行器或
Judge 变更后仍须重新登记与绑定。取消、App 关闭、父进程消失、worker 故障和重启中断继续清理子进程、保留
本次真实终态回执。等待器无固定 55 分钟截止，仅解释匹配 Camp 与工作区的回执，不能使用上次报告替代。

`rovai app` 的受管 Runtime 防误调用保持不变；登记须由用户普通终端执行，不通过清除环境标记绕过。

## Hermes 显式恢复

新增封闭操作 `agentRun.hermesRecovery.inspect` / `.resolve`，分别映射 Core
`agentRuns.hermesRecovery.inspect` / `.resolve`。CLI 为 `agent-run hermes-inspect` /
`agent-run hermes-discard`，参数、确认与原生身份约束见
[Hermes 未知执行合同](hermes-managed-runtime-v1.md#用户明确处理未知执行)。
确认文件冻结精确目标，CLI 从其 canonical digest 派生稳定 commandId；运输失败时用户复用该文件核对。
Main 不接受任意 RPC method、原生 Home 或 executable 参数。Core 记录用户意图及回执，禁止把维护操作
转成业务输入、自动重放或成功 Run。原失败与已发生效果保留，后续新任务须由用户另行提交。
