---
document_type: protocol-contract
contract: camp-message-send-v31
status: accepted
version: 31
source_version: v1.72
last_updated: 2026-11-11
---

# Camp Message Send v31

[Thread Fork v1](thread-fork-v1.md) 的历史复制不调用普通发送、不生成投递；副本后续发送继续遵守本合同。
复制消息清除旧 Run／投递／操作关联，模型信息继续按现有记录展示，不增加分叉专用上下文输入。

继承 [v30](camp-message-send-v30.md)。

目录与文件共用事务外预检和事务内绑定复核；正式 project_file_reference 段的可选 targetKind 为 directory 时由 Core 构造。
文件与目录合计最多 32 个不同条目；同 rawReference 的不同预期类型拒绝，不能经去重绕过。
目录类型互换为 target_kind_changed，错误仍定位 segmentIndex 并留完整草稿。有效目录可单独或与成员/文字/附件发送，不改变路由。
幂等回放优先于文件系统，Pending 激活/邀请/发布/投递仍原子；其他行为不变。
模型正文、字节预算与身份见 [项目引用 v2](project-file-reference-v2.md)。
