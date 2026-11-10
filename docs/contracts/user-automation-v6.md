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

未上线的 hermes-inspect/hermes-discard 及私有恢复 RPC 已退出生产接线，不保留兼容分支。
原生 unknown 保留事实，按官方入口明确处理，不自动换 Session 或重放任务。
Hermes 原生会话 CLI 环境仍禁止用户级 `rovai app`。
详见 [Hermes 未知执行合同](hermes-managed-runtime-v1.md#用户明确处理未知执行)。
