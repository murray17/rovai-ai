---
document_type: protocol-contract
contract: camp-composer-draft-v21
status: accepted
version: 21
source_version: v1.72
last_updated: 2026-11-07
---

# Camp Composer Draft v21

继承 [v20](camp-composer-draft-v20.md)，ComposerDocument 仍为 version 2。
公开 Active／普通 Pending 新增 `project_file_reference` Atom，必填完整 `labelFallback`，
保存 Thread 与根绑定 rawReference；浏览 scope 不进入草稿。短标签和同名消歧只影响显示。

文件、成员、对话与使命候选可独立分组返回；手动类别在当前触发内固定。选择后直接插入，预览由主动操作打开。
合成输入、迟到响应、撤销重做、原子删除、输入历史和失败留稿继续由同一编辑器负责。
跨对话粘贴须经目标 Host 重新确认，未完成或失败时保留引用并阻止旧身份发送。

有效文件本身构成输入；文件加其他引用也可发送。只有成员／普通引用或空白仍不构成本轮输入，附件和 Skill 保持既有规则。
未知文档格式不能规范化为空稿或覆盖本地原始记录。
完整字段、恢复与字节规则见 [Project File Reference v1](project-file-reference-v1.md)及
[已确认 R1](../versions/v1.72/model-context-change-project-file-reference.md)。
