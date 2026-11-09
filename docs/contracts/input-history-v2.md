---
document_type: protocol-contract
contract: input-history-v2
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-11-07
---

# Input History v2

继承 [v1](input-history-v1.md)。从已发送内容构造输入历史时保留 `project_file_reference`，
每次出现都按原位置恢复为草稿 Atom，使用已保存的 Thread、rawReference 和完整 labelAtSend。
恢复只检查显示可用性，不重写历史发布字段或冻结输入；再次发送视为新命令，重新校验当前身份。

本地草稿和明确发送失败同样保留完整 Atom。跨对话恢复、网络未知与根变化的处理见
[Project File Reference v1](project-file-reference-v1.md)；撤回短期重编单独遵循 [Message Reedit v2](message-reedit-v2.md)。
