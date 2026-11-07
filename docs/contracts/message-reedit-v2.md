---
document_type: protocol-contract
contract: message-reedit-v2
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-11-07
---

# Message Reedit v2

继承 [v1](message-reedit-v1.md)。撤回后短期重编保持既有正文和明示成员提及范围。
已发布项目文件段在原位置回填完整 labelAtSend 文字，不恢复为 Atom，不静默遗漏路径。
输入历史和发送失败恢复仍保留文件 Atom，不能误用撤回重编的文字回填规则。
完整生命周期见 [Project File Reference v1](project-file-reference-v1.md)。
