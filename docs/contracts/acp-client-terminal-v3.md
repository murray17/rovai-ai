---
document_type: contract
name: ACP Client Terminal
version: v3
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# ACP Client Terminal v3

继承 [v2](acp-client-terminal-v2.md) 的 capability policy、ACP wire、最终 cwd/env 解析、有界输出、
owner/epoch/Session 准入和 Terminal 生命周期。本版仅跟随
[Managed Runtime Process v2](managed-runtime-process-v2.md) 移除 macOS User Automation protected-tree deny；
v1、v2 的该项继承承诺不再适用。

Client Terminal 仍从已准入 Runtime Host 的 launch snapshot 派生 `RuntimeOneShot`，继承精确环境、
provider/Built-in CLI、PATH 和平台进程树所有权，再应用请求 env。Core 直接启动派生命令，不配置
User Automation denial root，也不增加 Rovai 外层沙箱或替代文件限制。Unix process group、Windows Job、
stdio、取消和后代回收保持原合同。

`rovai app` 的正常环境防误调用由 [User Automation v5](user-automation-v5.md) 拥有，不承诺抵御同 UID
进程主动清除标记。v2 的其他验收项继续适用；历史平台证据保留原样，不作为本次变更后的独立资格证明。
取舍见 [V1.58-D05](../versions/v1.58/decisions.md#v1-58-d05)。
