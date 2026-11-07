---
document_type: protocol-contract
contract: thread-reference-v2
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-11-07
---

# Thread Reference v2

继承 [v1](thread-reference-v1.md)。公开 `@` 菜单保留队员／对话／使命，并新增文件类别。
普通查询按组返回各来源结果；文件名或路径明确匹配时提高文件组排序。队员命中不阻止文件检索，
文件失败不阻止对话和使命返回。裸 `@` 优先队员，手动筛选在本次触发期间固定。

键盘选中项按候选身份保持，异步新增结果不能挪走用户已移动到的选项；加载、错误和旧查询不得触发发送。
文件身份、短标签、独立 scope、部分结果和迟到插入隔离见 [Project File Reference v1](project-file-reference-v1.md)。
已有对话／使命身份、发布标题与权限边界保持；文件不采用它们的普通 ID 长度上限。
