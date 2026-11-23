---
document_type: contract
name: Runtime Launch and Verification
version: v98
status: accepted
source_version: v1.72
last_updated: 2026-11-23
---

# Runtime Launch and Verification v98

继承 [v97](runtime-launch-and-verification-v97.md)。

## Codex 原生问卷

Rovai 启动 Codex Host 时传入 `-c tools.experimental_request_user_input.enabled=false`，
在支持该开关的版本中同时关闭 `request_user_input` 和 `request_user_input_async`。
配置的作用域为本次 App-Server 子进程。版本边界见[兼容性清单](../runtime-compatibility.md#2026-11-23-codex-原生问卷)。

开关进入 Host 进程兼容摘要。下次获取 Host 时，Fleet 回收旧策略的空闲进程，并在活跃 Run 结束后退役其进程。
替换后的 Host 使用既有 Native Binding 和 Thread ID 执行 `thread/resume`。

新 Thread 的模型工具清单应省略两项问卷。恢复已有 Thread 时，原生历史可能保留旧定义，验收检查当前轮的工具移除通知和实际调用结果。
两种调用均应被 Codex 拒绝，同步问卷请求和异步问卷事件均为零。
