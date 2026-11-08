---
document_type: protocol-contract
contract: thread-reference-v3
status: accepted
version: 3
source_version: v1.72
last_updated: 2026-11-08
---

# Thread Reference v3

继承 [v2](thread-reference-v2.md)。

公开 @ 保留队员、文件、对话、使命四个独立 Tab，每次只展示当前类别。手动选择在本次触发固定；异步结果不切回。
裸 @ 优先队员，路径/扩展名优先文件；普通名称按已有优先顺序选择有结果的一类。各来源搜索独立，失败不妨碍切换。
文件类别同时包含合法文件和目录，采用同一种选择交互，目录名不带末尾 /。完整规则见 [项目引用 v2](project-file-reference-v2.md)。
Thread/Mission identity、发送标题冻结和弱引用字段保持。
