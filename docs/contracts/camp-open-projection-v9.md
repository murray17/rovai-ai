---
document_type: contract
name: Camp Open Projection
version: v9
status: accepted
source_version: v1.33
last_updated: 2026-08-31
---

# Camp Open Projection v9

v9 replaces [v8](camp-open-projection-v8.md). 有界集合、事务 high-water、历史分页、membership reconciliation、
非终态 Evidence 和文件变化投影不变。`CampMemberView` 增加可选 `fast`，字段与资格见
[Camp Member Fast v1](camp-member-fast-v1.md#用户命令与只读投影)。

缺少资格时省略字段；旧 reader 可忽略该字段，新 reader 允许缺失。因此 Snapshot schema 34 / Open schema 5
保持不变。读取只查询数据库缓存，不启动 native auth/config/model 检查，不发起模型请求。Fast 更新事件
触发当前 Camp 投影刷新；不改变消息分页 cursor、导航 snapshot 或 Activity 映射。
