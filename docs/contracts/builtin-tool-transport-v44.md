---
document_type: protocol-contract
contract: builtin-tool-transport-v44
authority: builtin-tool-transport
status: accepted
version: 44
source_version: v1.72
last_updated: 2026-10-22
---

# Built-in Tool Transport v44

继承 [v43](builtin-tool-transport-v43.md) 的输入来源、IPC、授权、完整交付、幂等与 Send 来源语义。
Transport/CLI **44**、capability `builtin_cli.transport.v44`；IPC **3**、Envelope **2**、Agent Output **14** 保持。

`thread.read` 增加可选 `after` / `--after`，精确输入和分页行为由 [History v15](camp-history-v15.md) 拥有。
CLI 与 Core 使用同一封闭 catalog 校验 before/after 互斥；直接参数、JSON stdin 与 input-file 一致。
description 增加排他 sequence、升序分页和同方向 nextCursor；示例以 after 替换重复的 limit 示例。
不增加根命令、Bootstrap、RUN_FACTS、工具输出字段或通用方向参数。

CLI/Core 配套发布，现有版本门在 dispatch 前拒绝不匹配版本。
原 before、单条和回复链请求不改写；历史成功输出、Envelope、receipt 和摘要保留原字节。
Native Binding、冻结上下文、数据库 schema 与 Session 恢复资格不变。
