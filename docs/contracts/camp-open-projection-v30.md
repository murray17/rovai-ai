---
document_type: protocol-contract
contract: camp-open-projection-v30
status: accepted
version: 30
source_version: v1.72
last_updated: 2026-10-21
---

# Camp Open Projection v30

继承 [camp-open-projection-v29](camp-open-projection-v29.md) 未被下述条款替代的规则。

Thread snapshot schema **36**，threads.open schema **9**。两者增加必需 tasksEnabled:boolean。关闭时省略 tasks；open.coverage 省略 tasks；会话列表省略 openTaskCount 并包含 tasksEnabled。成员移除预览省略 openAssignedTaskCount。不能用空数组/0 冒充关闭投影；Task 查询/计数在关闭分支不执行。

Thread snapshot 与 open header 的 `thread.navigationGroupKey` 与 Navigation 行使用同一归组事实，
用于启动恢复、窗口外会话打开及侧栏高亮；`chat-bot` 不被当作待登记的资料目录项目。
这是只读导航展示投影，不改变实际工作目录、会话执行、模型输入或已有 schema 版本；
字段与分类边界见 [Navigation Read v1](navigation-read-v1.md)。

普通事件展示在 SQL 分页前排除 Task 事件，显式历史审计与原始消息/Run 关联保留。Renderer 在 capability 失效时清理 Task 缓存、面板与定位，并拦截迟到响应；草稿、阅读位置与执行内容保持。
