---
document_type: interface-contract
contract: user-automation
version: 5
authority: desktop-user-automation-and-evaluation-host
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# User Automation v5

继承 [v4](user-automation-v4.md) 的命令、运输、实例凭据、幂等、错误脱敏、Trace 与评测宿主行为。
本版明确替代 v1 至 v4 继承的全部 Runtime OS denial、protected-tree deny 和同 UID 防绕过承诺。
运输 `contractVersion: 1`、Data Contract、Agent Built-in 与模型上下文不变。

## Agent CLI 防误调用

`rovai app` 是普通用户控制接口，Agent 应使用已有 Agent CLI。CLI 在解析 `app` 后、读取用户连接上下文或
连接 IPC 前，检查 `ROVAI_CLI_CONTEXT` 与 `ROVAI_RUN_TMP`：任一标记存在（包括空字符串）即拒绝。
拒绝保持退出码 `2`，输出稳定 JSON：

```json
{"error":{"code":"user_automation.unavailable_in_managed_runtime","message":"User Automation is unavailable inside a Core-managed Runtime process.","recovery":"stop"}}
```

同一判断隐藏受管 Runtime 中根帮助的 `app` 入口。两项标记都不存在时进入普通 User Automation 路径，仍须
验证当前实例、凭据和封闭 operation；Agent 的 process-private context 不能代替用户凭据。
正常继承环境的 Shell 与后代同样被拒绝。这是防误调用约定，不承诺识别主动清除标记、构造 IPC 或伪装为
普通终端的同一 OS 用户进程。

## Runtime 启动与本机文件

Core 不配置 User Automation denial root；所有 Runtime、Probe 和派生进程均取消 Rovai 外层
`sandbox-exec` 包装，见 [Managed Runtime Process v2](managed-runtime-process-v2.md)。不增加替代 sandbox、
隐藏降级开关或另一套按 Adapter 选择的文件限制；Runtime 自己的权限设置仍由它自身实施。

用户 connection context、日报配置、评测配置、job 回执和 worker 结果继续使用原私有目录及文件权限，
凭据不进入日志、错误或 Agent 上下文。此处的“私有”仅指本地存储和受控接口，不代表对同 UID Agent 的
OS 级文件隔离；Host 准备报告、Agent 读取工作区结果的既有协作流程继续适用。

App 启动时自动尝试建立用户接口，退出时关闭；接口初始化失败不阻止 Desktop/Core 启动，CLI 不能暗中
启动 App。Windows User Automation 的既有显式验收开关不变，本版不提升任何平台或 Runtime 的验收资格。
