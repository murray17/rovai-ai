---
document_type: contract
name: Single Chat
version: v4
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Single Chat v4

继承 [v3](single-chat-v3.md) 的本机 Owner 注意力、Run CampTurn ID、精确私有审批投影，以及 v2 的私有路由、
结束、FIFO、Context/Built-in policy 和目标代次 fence。本版本只替换 Source Attachment 的 Runtime 交付语义：
统一遵循 [Camp Attachment v9](camp-attachment-v9.md)。

Single Chat Composer、Pending、Pending Edit 与 Message 继续保存相同的 owner-scoped Source Refs；发送、排队、
修复和一次性 Draft 消费均不变。Run 前由共享 resolver 在 `spawn_blocking` 中重检源路径存在、宿主可读且
`file | directory` 类型未变，然后把完全相同的 stored `sourcePath` 按原顺序写入
`CURRENT_INPUT.attachments`。不比较 execution root，不 canonicalize，不复制到 Run Temp，也不递归预扫目录。

`sourcePath` 不进入 Renderer、Single Chat Snapshot/History、公共消息或公共历史 View，但对目标 Runtime、Agent
及可能接收请求的模型 Provider 可见。宿主重检不保证 Runtime 可读；Runtime/OS 权限失败只在 Agent 实际访问时
由原生文件工具报告，没有 preflight、重试、权限扩大或 materialize/upload fallback。

既有 Single Chat Source Refs 在后续运行直接采用新行为。数据库、历史 ContextManifest、Prepared、Managed 与
Agent attachment 均不迁移或改写；本版本不新增字段、状态、Runtime capability 或配置开关。
