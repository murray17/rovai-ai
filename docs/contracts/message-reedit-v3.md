---
document_type: protocol-contract
contract: message-reedit-v3
status: accepted
version: 3
source_version: v1.72
last_updated: 2026-11-08
---

# Message Reedit v3

继承 [v2](message-reedit-v2.md)。

目录引用与文件引用保持同一撤回回填边界：回填完整项目相对路径文字，保留正文位置，不恢复引用身份。
普通草稿、输入历史和发送失败仍保留 Atom 及目录类型；见 [项目引用 v2](project-file-reference-v2.md)。其余撤回和清理语义保持。
